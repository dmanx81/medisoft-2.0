import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { brandingSchema, fieldErrors } from './validation';
import { ClinicalError, type OrganizationBranding } from './types';
import { clinicalTransaction } from './transaction';
import { assertSafeImage } from './image';

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new ClinicalError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}

async function audit(
  db: QueryRunner,
  principal: Principal,
  action: string,
  metadata: Record<string, unknown> = {},
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
    await db.query<Omit<OrganizationBranding, 'has_logo'> & { has_logo: string }>(
      `SELECT name,legal_name,COALESCE(address,'') AS address,city,postal_code,country,
 COALESCE(phone,'') AS phone,COALESCE(email,'') AS email,website,registration_number,
 EXISTS(SELECT 1 FROM organization_assets a WHERE a.organization_id=organizations.id AND a.kind='LOGO')::text AS has_logo
 FROM organizations WHERE id=$1`,
      [principal.organizationId],
    )
  ).rows[0];
  if (!row)
    throw new ClinicalError(404, 'NOT_FOUND', 'Organization not found.');
  return { ...row, has_logo: row.has_logo === 'true' };
}

export async function updateBranding(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<OrganizationBranding> {
  permit(principal, 'settings:read');
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the organization branding details.',
      fieldErrors(parsed.error),
    );
  return clinicalTransaction(db, async () => {
    await db.query(
      `UPDATE organizations SET legal_name=$2,address=$3,city=$4,postal_code=$5,phone=$6,email=$7,
 website=$8,registration_number=$9 WHERE id=$1`,
      [
        principal.organizationId,
        parsed.data.legal_name,
        parsed.data.address,
        parsed.data.city,
        parsed.data.postal_code,
        parsed.data.phone,
        parsed.data.email,
        parsed.data.website,
        parsed.data.registration_number,
      ],
    );
    await audit(db, principal, 'ORGANIZATION_BRANDING_UPDATED', {
      fields: ['legal_name', 'address', 'registration_number'],
    });
    return getBranding(db, principal);
  });
}

export async function saveOrganizationLogo(
  db: QueryRunner,
  principal: Principal,
  file: { type: string; bytes: Buffer; name?: string },
): Promise<OrganizationBranding> {
  permit(principal, 'settings:read');
  const image = await assertSafeImage(file);
  return clinicalTransaction(db, async () => {
    const existing = (
      await db.query<{ id: string }>(
        `SELECT id FROM organization_assets WHERE organization_id=$1 AND kind='LOGO' FOR UPDATE`,
        [principal.organizationId],
      )
    ).rows[0];
    if (existing)
      await db.query(
        `UPDATE organization_assets SET content_type=$3,bytes=$4 WHERE organization_id=$1 AND id=$2`,
        [principal.organizationId, existing.id, image.type, image.bytes],
      );
    else
      await db.query(
        `INSERT INTO organization_assets(organization_id,kind,content_type,bytes,created_by)
 VALUES($1,'LOGO',$2,$3,$4)`,
        [principal.organizationId, image.type, image.bytes, principal.userId],
      );
    await audit(db, principal, 'ORGANIZATION_LOGO_UPDATED', {
      content_type: image.type,
      bytes: image.bytes.length,
    });
    return getBranding(db, principal);
  });
}

export async function getOrganizationLogo(
  db: QueryRunner,
  principal: Principal,
) {
  permit(principal, 'settings:read');
  const row = (
    await db.query<{ content_type: string; bytes: Buffer }>(
      `SELECT content_type,bytes FROM organization_assets
 WHERE organization_id=$1 AND kind='LOGO'`,
      [principal.organizationId],
    )
  ).rows[0];
  if (!row) throw new ClinicalError(404, 'NOT_FOUND', 'No logo is configured.');
  return row;
}
