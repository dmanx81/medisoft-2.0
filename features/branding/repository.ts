import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { processDocumentImage } from './assets';
import { brandingSchema, fieldErrors } from './validation';
import {
  BrandingError,
  type OrganizationAsset,
  type OrganizationBranding,
} from './types';

const brandingSelect = `name,legal_name,slug,type,COALESCE(address,'') AS address,city,postal_code,
 country,COALESCE(phone,'') AS phone,COALESCE(email,'') AS email,website,registration_number,
 COALESCE(logo_asset_id::text,'') AS logo_asset_id`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new BrandingError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function mapBranding(row: OrganizationBranding): OrganizationBranding {
  return { ...row, has_logo: Boolean(row.logo_asset_id) };
}
function asBytes(value: Buffer) {
  return Uint8Array.from(value);
}
async function transaction<T>(db: QueryRunner, work: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
async function audit(
  db: QueryRunner,
  principal: Principal,
  action: string,
  metadata: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,'ORGANIZATION',$4,$5::jsonb,$6)`,
    [
      principal.organizationId,
      principal.userId,
      action,
      principal.organizationId,
      JSON.stringify(metadata),
      principal.sessionHash,
    ],
  );
}

export async function getBranding(
  db: QueryRunner,
  principal: Principal,
): Promise<OrganizationBranding> {
  permit(principal, 'settings:read');
  const row = (
    await db.query<OrganizationBranding>(
      `SELECT ${brandingSelect} FROM organizations WHERE id=$1`,
      [principal.organizationId],
    )
  ).rows[0];
  if (!row)
    throw new BrandingError(404, 'NOT_FOUND', 'Organization not found.');
  return mapBranding(row);
}

export async function updateBranding(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<OrganizationBranding> {
  permit(principal, 'settings:edit');
  permit(principal, 'settings:read');
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success)
    throw new BrandingError(
      400,
      'VALIDATION',
      'Check the highlighted fields.',
      fieldErrors(parsed.error),
    );
  return transaction(db, async () => {
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
      principal.organizationId,
    ]);
    const updated = (
      await db.query<OrganizationBranding>(
        `UPDATE organizations SET name=$2,legal_name=$3,address=$4,city=$5,postal_code=$6,
 country=$7,phone=$8,email=$9,website=$10,registration_number=$11
 WHERE id=$1
 RETURNING ${brandingSelect}`,
        [
          principal.organizationId,
          parsed.data.name,
          parsed.data.legal_name,
          parsed.data.address || null,
          parsed.data.city,
          parsed.data.postal_code,
          parsed.data.country,
          parsed.data.phone || null,
          parsed.data.email || null,
          parsed.data.website,
          parsed.data.registration_number,
        ],
      )
    ).rows[0];
    await audit(db, principal, 'ORGANIZATION_BRANDING_UPDATED', {
      name: parsed.data.name,
      legal_name: parsed.data.legal_name,
      city: parsed.data.city,
      country: parsed.data.country,
    });
    return mapBranding(updated);
  });
}

export async function getLogoAsset(
  db: QueryRunner,
  principal: Principal,
): Promise<OrganizationAsset | null> {
  permit(principal, 'settings:read');
  const row = (
    await db.query<OrganizationAsset>(
      `SELECT a.id,a.organization_id,a.kind,a.content_type,a.bytes,a.byte_size,a.width,a.height,
 a.original_filename
 FROM organizations o
 JOIN organization_assets a ON a.organization_id=o.id AND a.id=o.logo_asset_id
 WHERE o.id=$1 AND a.kind='LOGO'`,
      [principal.organizationId],
    )
  ).rows[0];
  return row ?? null;
}

export async function upsertLogo(
  db: QueryRunner,
  principal: Principal,
  upload: { bytes: Buffer; filename: string },
): Promise<OrganizationBranding> {
  permit(principal, 'settings:edit');
  permit(principal, 'settings:read');
  const processed = await processDocumentImage(upload.bytes, upload.filename, {
    maxBytes: 2_097_152,
    maxWidth: 800,
    maxHeight: 400,
  });
  return transaction(db, async () => {
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
      principal.organizationId,
    ]);
    const existing = (
      await db.query<{ logo_asset_id: string }>(
        `SELECT COALESCE(logo_asset_id::text,'') AS logo_asset_id FROM organizations WHERE id=$1`,
        [principal.organizationId],
      )
    ).rows[0];
    let assetId = existing?.logo_asset_id || '';
    if (assetId) {
      await db.query(
        `UPDATE organization_assets SET bytes=$3,byte_size=$4,width=$5,height=$6,
 original_filename=$7,updated_by=$8
 WHERE organization_id=$1 AND id=$2 AND kind='LOGO'`,
        [
          principal.organizationId,
          assetId,
          asBytes(processed.bytes),
          processed.bytes.length,
          processed.width,
          processed.height,
          processed.original_filename,
          principal.userId,
        ],
      );
    } else {
      const inserted = (
        await db.query<{ id: string }>(
          `INSERT INTO organization_assets(organization_id,kind,content_type,bytes,byte_size,width,height,
 original_filename,created_by,updated_by)
 VALUES($1,'LOGO','image/png',$2,$3,$4,$5,$6,$7,$7)
 RETURNING id`,
          [
            principal.organizationId,
            asBytes(processed.bytes),
            processed.bytes.length,
            processed.width,
            processed.height,
            processed.original_filename,
            principal.userId,
          ],
        )
      ).rows[0];
      assetId = inserted.id;
      await db.query(
        'UPDATE organizations SET logo_asset_id=$2 WHERE id=$1',
        [principal.organizationId, assetId],
      );
    }
    await audit(db, principal, 'ORGANIZATION_LOGO_UPDATED', {
      asset_id: assetId,
      width: processed.width,
      height: processed.height,
    });
    return getBranding(db, principal);
  });
}

export async function clearLogo(
  db: QueryRunner,
  principal: Principal,
): Promise<OrganizationBranding> {
  permit(principal, 'settings:edit');
  permit(principal, 'settings:read');
  return transaction(db, async () => {
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
      principal.organizationId,
    ]);
    const previous = (
      await db.query<{ logo_asset_id: string }>(
        `SELECT COALESCE(logo_asset_id::text,'') AS logo_asset_id FROM organizations WHERE id=$1`,
        [principal.organizationId],
      )
    ).rows[0];
    await db.query('UPDATE organizations SET logo_asset_id=NULL WHERE id=$1', [
      principal.organizationId,
    ]);
    if (previous?.logo_asset_id) {
      await db.query(
        'DELETE FROM organization_assets WHERE organization_id=$1 AND id=$2 AND kind=$3',
        [principal.organizationId, previous.logo_asset_id, 'LOGO'],
      );
    }
    await audit(db, principal, 'ORGANIZATION_LOGO_CLEARED', {
      asset_id: previous?.logo_asset_id || '',
    });
    return getBranding(db, principal);
  });
}

export async function loadAssetForSnapshot(
  db: QueryRunner,
  organizationId: string,
  assetId: string | null | undefined,
): Promise<{ png_base64: string; width: number; height: number } | null> {
  if (!assetId) return null;
  const row = (
    await db.query<{ bytes: Buffer; width: string; height: string }>(
      `SELECT bytes,width::text,height::text FROM organization_assets
 WHERE organization_id=$1 AND id=$2`,
      [organizationId, assetId],
    )
  ).rows[0];
  if (!row) return null;
  const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
  return {
    png_base64: bytes.toString('base64'),
    width: Number(row.width),
    height: Number(row.height),
  };
}
