import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { processDocumentImage } from '@/features/branding/assets';
import { loadAssetForSnapshot } from '@/features/branding/repository';
import {
  createDoctorSchema,
  displayNameOf,
  doctorIdSchema,
  fieldErrors,
  searchSchema,
  updateDoctorSchema,
} from './validation';
import {
  DoctorError,
  type Doctor,
  type DoctorPage,
  type DoctorSummary,
  type StaffCandidate,
} from './types';

export const doctorSelect = `d.id,d.organization_id,d.user_id,u.name AS user_name,u.email AS user_email,
 u.role AS user_role,u.status AS user_status,d.first_name,d.last_name,d.display_name,d.title,
 d.specialty,d.license_number,d.phone,d.email,d.qualifications,d.department,
 COALESCE(d.signature_asset_id::text,'') AS signature_asset_id,d.status,d.version,
 d.created_at::text,d.updated_at::text,d.created_by,d.updated_by`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new DoctorError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string) {
  if (!doctorIdSchema.safeParse(id).success)
    throw new DoctorError(404, 'NOT_FOUND', 'Doctor not found.');
  return id;
}
function notFound(): never {
  throw new DoctorError(404, 'NOT_FOUND', 'Doctor not found.');
}
function invalid(error: Parameters<typeof fieldErrors>[0]): never {
  throw new DoctorError(
    400,
    'VALIDATION',
    'Check the highlighted fields.',
    fieldErrors(error),
  );
}
function stale(): never {
  throw new DoctorError(
    409,
    'STALE_VERSION',
    'This doctor profile changed. Reload and try again.',
  );
}
function mapDoctor(row: Doctor): Doctor {
  return {
    ...row,
    version: Number(row.version),
    has_signature: Boolean(row.signature_asset_id),
  };
}
async function transaction<T>(db: QueryRunner, work: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === '23505'
    )
      throw new DoctorError(
        409,
        'DOCTOR_EXISTS',
        'This staff member already has a doctor profile.',
      );
    throw error;
  }
}
async function audit(
  db: QueryRunner,
  principal: Principal,
  entityId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,'DOCTOR',$4,$5::jsonb,$6)`,
    [
      principal.organizationId,
      principal.userId,
      action,
      entityId,
      JSON.stringify(metadata),
      principal.sessionHash,
    ],
  );
}

export async function getDoctor(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<Doctor> {
  permit(principal, 'doctors:read');
  const row = (
    await db.query<Doctor>(
      `SELECT ${doctorSelect}
 FROM doctors d
 JOIN users u ON u.organization_id=d.organization_id AND u.id=d.user_id
 WHERE d.organization_id=$1 AND d.id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  return row ? mapDoctor(row) : notFound();
}

export async function getDoctorByUser(
  db: QueryRunner,
  principal: Principal,
): Promise<Doctor | null> {
  permit(principal, 'doctors:read');
  const row = (
    await db.query<Doctor>(
      `SELECT ${doctorSelect}
 FROM doctors d
 JOIN users u ON u.organization_id=d.organization_id AND u.id=d.user_id
 WHERE d.organization_id=$1 AND d.user_id=$2`,
      [principal.organizationId, principal.userId],
    )
  ).rows[0];
  return row ? mapDoctor(row) : null;
}

export async function listDoctors(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<DoctorPage> {
  permit(principal, 'doctors:read');
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const { query, status, page, pageSize } = parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `d.organization_id=$1 AND ($2='ALL' OR d.status=$2) AND ($3='' OR
 d.display_name ILIKE $4 ESCAPE '\\' OR d.last_name ILIKE $4 ESCAPE '\\'
 OR d.first_name ILIKE $4 ESCAPE '\\' OR d.specialty ILIKE $4 ESCAPE '\\'
 OR d.license_number ILIKE $4 ESCAPE '\\' OR u.name ILIKE $4 ESCAPE '\\')`;
  const values = [principal.organizationId, status, query, pattern];
  const total = Number(
    (
      await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM doctors d
 JOIN users u ON u.organization_id=d.organization_id AND u.id=d.user_id
 WHERE ${where}`,
        values,
      )
    ).rows[0].count,
  );
  const doctors = (
    await db.query<DoctorSummary>(
      `SELECT d.id,d.display_name,d.title,d.specialty,d.license_number,d.status,u.name AS user_name,
 d.updated_at::text
 FROM doctors d
 JOIN users u ON u.organization_id=d.organization_id AND u.id=d.user_id
 WHERE ${where}
 ORDER BY lower(d.last_name),lower(d.first_name),d.id
 LIMIT $5 OFFSET $6`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { doctors, total, page, pageSize };
}

export async function listStaffCandidates(
  db: QueryRunner,
  principal: Principal,
): Promise<StaffCandidate[]> {
  permit(principal, 'doctors:manage');
  return (
    await db.query<StaffCandidate>(
      `SELECT u.id,u.name,u.email,u.role,u.status
 FROM users u
 WHERE u.organization_id=$1 AND NOT EXISTS (
  SELECT 1 FROM doctors d WHERE d.organization_id=u.organization_id AND d.user_id=u.id
 )
 ORDER BY lower(u.name),u.id`,
      [principal.organizationId],
    )
  ).rows;
}

export async function createDoctor(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<Doctor> {
  permit(principal, 'doctors:manage');
  const parsed = createDoctorSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const display = displayNameOf(parsed.data);
  return transaction(db, async () => {
    const staff = (
      await db.query<{ id: string }>(
        `SELECT id FROM users WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, parsed.data.user_id],
      )
    ).rows[0];
    if (!staff)
      throw new DoctorError(
        400,
        'VALIDATION',
        'Choose a staff member from this organization.',
        { user_id: 'Staff member not found in this organization.' },
      );
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO doctors(organization_id,user_id,first_name,last_name,display_name,title,specialty,
 license_number,phone,email,qualifications,department,status,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
 RETURNING id`,
        [
          principal.organizationId,
          parsed.data.user_id,
          parsed.data.first_name,
          parsed.data.last_name,
          display,
          parsed.data.title,
          parsed.data.specialty,
          parsed.data.license_number,
          parsed.data.phone,
          parsed.data.email,
          parsed.data.qualifications,
          parsed.data.department,
          parsed.data.status,
          principal.userId,
        ],
      )
    ).rows[0];
    await audit(db, principal, inserted.id, 'DOCTOR_CREATED', {
      user_id: parsed.data.user_id,
      display_name: display,
      status: parsed.data.status,
    });
    return getDoctor(db, principal, inserted.id);
  });
}

export async function updateDoctor(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<Doctor> {
  permit(principal, 'doctors:manage');
  const parsed = updateDoctorSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const display = displayNameOf(parsed.data);
  return transaction(db, async () => {
    const locked = (
      await db.query<{ id: string; status: string; version: string }>(
        `SELECT id,status,version::text FROM doctors
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE doctors SET first_name=$3,last_name=$4,display_name=$5,title=$6,specialty=$7,
 license_number=$8,phone=$9,email=$10,qualifications=$11,department=$12,status=$13,
 updated_by=$14,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$15
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          parsed.data.first_name,
          parsed.data.last_name,
          display,
          parsed.data.title,
          parsed.data.specialty,
          parsed.data.license_number,
          parsed.data.phone,
          parsed.data.email,
          parsed.data.qualifications,
          parsed.data.department,
          parsed.data.status,
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await audit(db, principal, locked.id, 'DOCTOR_UPDATED', {
      fields: Object.keys(parsed.data).filter((key) => key !== 'version'),
    });
    if (locked.status !== parsed.data.status) {
      await audit(
        db,
        principal,
        locked.id,
        parsed.data.status === 'ACTIVE' ? 'DOCTOR_ACTIVATED' : 'DOCTOR_DEACTIVATED',
        { previous: locked.status, status: parsed.data.status },
      );
    }
    return getDoctor(db, principal, locked.id);
  });
}

export async function upsertDoctorSignature(
  db: QueryRunner,
  principal: Principal,
  id: string,
  upload: { bytes: Buffer; filename: string },
): Promise<Doctor> {
  permit(principal, 'doctors:manage');
  const processed = await processDocumentImage(upload.bytes, upload.filename, {
    maxBytes: 1_048_576,
    maxWidth: 400,
    maxHeight: 160,
  });
  return transaction(db, async () => {
    const locked = (
      await db.query<{ id: string; signature_asset_id: string }>(
        `SELECT id,COALESCE(signature_asset_id::text,'') AS signature_asset_id
 FROM doctors WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    let assetId = locked.signature_asset_id;
    if (assetId) {
      await db.query(
        `UPDATE organization_assets SET bytes=$3,byte_size=$4,width=$5,height=$6,
 original_filename=$7,updated_by=$8
 WHERE organization_id=$1 AND id=$2 AND kind='DOCTOR_SIGNATURE'`,
        [
          principal.organizationId,
          assetId,
          processed.bytes,
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
 VALUES($1,'DOCTOR_SIGNATURE','image/png',$2,$3,$4,$5,$6,$7,$7)
 RETURNING id`,
          [
            principal.organizationId,
            processed.bytes,
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
        `UPDATE doctors SET signature_asset_id=$3,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2`,
        [principal.organizationId, locked.id, assetId, principal.userId],
      );
    }
    await audit(db, principal, locked.id, 'DOCTOR_SIGNATURE_UPDATED', {
      asset_id: assetId,
    });
    return getDoctor(db, principal, locked.id);
  });
}

export async function clearDoctorSignature(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<Doctor> {
  permit(principal, 'doctors:manage');
  return transaction(db, async () => {
    const locked = (
      await db.query<{ id: string; signature_asset_id: string }>(
        `SELECT id,COALESCE(signature_asset_id::text,'') AS signature_asset_id
 FROM doctors WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    await db.query(
      `UPDATE doctors SET signature_asset_id=NULL,updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, locked.id, principal.userId],
    );
    if (locked.signature_asset_id) {
      await db.query(
        `DELETE FROM organization_assets WHERE organization_id=$1 AND id=$2 AND kind='DOCTOR_SIGNATURE'`,
        [principal.organizationId, locked.signature_asset_id],
      );
    }
    await audit(db, principal, locked.id, 'DOCTOR_SIGNATURE_CLEARED', {
      asset_id: locked.signature_asset_id,
    });
    return getDoctor(db, principal, locked.id);
  });
}

export async function loadDoctorSignatureSnapshot(
  db: QueryRunner,
  organizationId: string,
  assetId: string,
) {
  return loadAssetForSnapshot(db, organizationId, assetId);
}
