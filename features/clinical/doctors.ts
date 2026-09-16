import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { hashPassword } from '@/lib/auth/password';
import { randomBytes } from 'node:crypto';
import {
  doctorIdSchema,
  doctorSchema,
  doctorSearchSchema,
  doctorUpdateSchema,
  fieldErrors,
} from './validation';
import {
  ClinicalError,
  type ClinicalDoctor,
  type ClinicalDoctorPage,
  type StaffLookup,
} from './types';
import { clinicalTransaction } from './transaction';
import { asBytea, assertSafeImage } from './image';

const selectDoctor = `id,organization_id,user_id,first_name,last_name,display_name,title,specialty,
 license_number,phone,email,qualifications,department,COALESCE(signature_asset_id::text,'') AS signature_asset_id,
 status,version,created_by,updated_by,created_at::text,updated_at::text`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new ClinicalError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}

function idValue(id: string) {
  if (!doctorIdSchema.safeParse(id).success)
    throw new ClinicalError(404, 'NOT_FOUND', 'Doctor not found.');
  return id;
}

function notFound(): never {
  throw new ClinicalError(404, 'NOT_FOUND', 'Doctor not found.');
}

async function audit(
  db: QueryRunner,
  principal: Principal,
  entityId: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,'CLINICAL_DOCTOR',$4,$5::jsonb,$6)`,
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

export async function listDoctors(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<ClinicalDoctorPage> {
  permit(principal, 'doctors:read');
  const parsed = doctorSearchSchema.safeParse(input ?? {});
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the search options.',
      fieldErrors(parsed.error),
    );
  const { query, page, pageSize, status } = parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `organization_id=$1 AND ($2='ALL' OR status=$2) AND ($3='' OR
 display_name ILIKE $4 ESCAPE '\\' OR last_name ILIKE $4 ESCAPE '\\' OR first_name ILIKE $4 ESCAPE '\\'
 OR specialty ILIKE $4 ESCAPE '\\' OR license_number ILIKE $4 ESCAPE '\\')`;
  const values = [principal.organizationId, status, query, pattern];
  const total = Number(
    (
      await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM clinical_doctors WHERE ${where}`,
        values,
      )
    ).rows[0]?.count ?? '0',
  );
  const doctors = (
    await db.query<ClinicalDoctorPage['doctors'][number]>(
      `SELECT id,display_name,title,specialty,license_number,status,department
 FROM clinical_doctors WHERE ${where}
 ORDER BY lower(last_name),lower(first_name),id
 LIMIT $5 OFFSET $6`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { doctors, total, page, pageSize };
}

export async function listStaffLookups(
  db: QueryRunner,
  principal: Principal,
): Promise<StaffLookup[]> {
  permit(principal, 'doctors:manage');
  return (
    await db.query<StaffLookup>(
      `SELECT u.id,u.name,u.email,u.role,u.status,COALESCE(d.id::text,'') AS doctor_id
 FROM users u
 LEFT JOIN clinical_doctors d ON d.organization_id=u.organization_id AND d.user_id=u.id
 WHERE u.organization_id=$1
 ORDER BY u.name,u.email`,
      [principal.organizationId],
    )
  ).rows;
}

export async function doctorProfileForUser(
  db: QueryRunner,
  principal: Principal,
) {
  permit(principal, 'doctors:read');
  return (
    await db.query<{ id: string }>(
      `SELECT id FROM clinical_doctors WHERE organization_id=$1 AND user_id=$2`,
      [principal.organizationId, principal.userId],
    )
  ).rows[0];
}

export async function getDoctor(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<ClinicalDoctor> {
  permit(principal, 'doctors:read');
  const row = (
    await db.query<ClinicalDoctor>(
      `SELECT ${selectDoctor} FROM clinical_doctors WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  return row ?? notFound();
}

export async function createDoctor(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<ClinicalDoctor> {
  permit(principal, 'doctors:manage');
  const parsed = doctorSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the doctor details.',
      fieldErrors(parsed.error),
    );
  const data = parsed.data;
  const display =
    data.display_name.trim() || `${data.first_name} ${data.last_name}`.trim();
  return clinicalTransaction(db, async () => {
    let userId = data.user_id;
    if (userId) {
      const staff = (
        await db.query<{ id: string }>(
          `SELECT id FROM users WHERE organization_id=$1 AND id=$2`,
          [principal.organizationId, userId],
        )
      ).rows[0];
      if (!staff)
        throw new ClinicalError(
          400,
          'VALIDATION',
          'Staff member was not found in this organization.',
          { user_id: 'Select a staff member from this organization.' },
        );
    } else {
      if (!data.email)
        throw new ClinicalError(
          400,
          'VALIDATION',
          'Provide a staff member or a login email for the new doctor.',
          { email: 'Email is required when creating a new staff doctor.' },
        );
      const existing = (
        await db.query<{ id: string; organization_id: string }>(
          'SELECT id,organization_id::text AS organization_id FROM users WHERE email=$1',
          [data.email],
        )
      ).rows[0];
      if (existing && existing.organization_id !== principal.organizationId)
        throw new ClinicalError(
          409,
          'CONFLICT',
          'That email is already used in another organization.',
          { email: 'Choose a different login email.' },
        );
      if (existing) userId = existing.id;
      else {
        const created = (
          await db.query<{ id: string }>(
            `INSERT INTO users(organization_id,name,email,password_hash,role,status)
 VALUES($1,$2,$3,$4,'DOCTOR','INVITED') RETURNING id`,
            [
              principal.organizationId,
              display,
              data.email,
              await hashPassword(randomBytes(32).toString('hex')),
            ],
          )
        ).rows[0];
        userId = created.id;
      }
    }
    const taken = (
      await db.query<{ id: string }>(
        `SELECT id FROM clinical_doctors WHERE organization_id=$1 AND user_id=$2`,
        [principal.organizationId, userId],
      )
    ).rows[0];
    if (taken)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'That staff member already has a doctor profile.',
        { user_id: 'Edit the existing doctor profile instead.' },
      );
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO clinical_doctors(
 organization_id,user_id,first_name,last_name,display_name,title,specialty,license_number,
 phone,email,qualifications,department,status,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING id`,
        [
          principal.organizationId,
          userId,
          data.first_name,
          data.last_name,
          display,
          data.title,
          data.specialty,
          data.license_number,
          data.phone,
          data.professional_email || data.email,
          data.qualifications,
          data.department,
          data.status,
          principal.userId,
        ],
      )
    ).rows[0];
    await audit(db, principal, inserted.id, 'CLINICAL_DOCTOR_CREATED', {
      fields: ['first_name', 'last_name', 'specialty'],
    });
    return getDoctor(db, principal, inserted.id);
  });
}

export async function updateDoctor(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<ClinicalDoctor> {
  permit(principal, 'doctors:manage');
  const parsed = doctorUpdateSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the doctor details.',
      fieldErrors(parsed.error),
    );
  return clinicalTransaction(db, async () => {
    const current = (
      await db.query<ClinicalDoctor>(
        `SELECT ${selectDoctor} FROM clinical_doctors WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!current) notFound();
    if (current.version !== parsed.data.version)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This doctor profile was changed by someone else. Reload and try again.',
      );
    const display =
      parsed.data.display_name.trim() ||
      `${parsed.data.first_name} ${parsed.data.last_name}`.trim();
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE clinical_doctors SET first_name=$3,last_name=$4,display_name=$5,title=$6,specialty=$7,
 license_number=$8,phone=$9,email=$10,qualifications=$11,department=$12,status=$13,
 updated_by=$14,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$15 RETURNING id`,
        [
          principal.organizationId,
          current.id,
          parsed.data.first_name,
          parsed.data.last_name,
          display,
          parsed.data.title,
          parsed.data.specialty,
          parsed.data.license_number,
          parsed.data.phone,
          parsed.data.professional_email,
          parsed.data.qualifications,
          parsed.data.department,
          parsed.data.status,
          principal.userId,
          parsed.data.version,
        ],
      )
    ).rows[0];
    if (!updated)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This doctor profile was changed by someone else. Reload and try again.',
      );
    const action =
      current.status !== parsed.data.status
        ? parsed.data.status === 'ACTIVE'
          ? 'CLINICAL_DOCTOR_ACTIVATED'
          : 'CLINICAL_DOCTOR_DEACTIVATED'
        : 'CLINICAL_DOCTOR_UPDATED';
    await audit(db, principal, current.id, action, {
      fields: ['display_name', 'specialty', 'status'],
    });
    return getDoctor(db, principal, current.id);
  });
}

export async function saveDoctorSignature(
  db: QueryRunner,
  principal: Principal,
  id: string,
  file: { type: string; bytes: Buffer; name?: string },
): Promise<ClinicalDoctor> {
  permit(principal, 'doctors:manage');
  const image = await assertSafeImage(file);
  return clinicalTransaction(db, async () => {
    const current = (
      await db.query<{ id: string; signature_asset_id: string }>(
        `SELECT id,COALESCE(signature_asset_id::text,'') AS signature_asset_id
 FROM clinical_doctors WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!current) notFound();
    let assetId = current.signature_asset_id;
    if (assetId) {
      await db.query(
        `UPDATE organization_assets SET content_type=$3,bytes=$4
 WHERE organization_id=$1 AND id=$2 AND kind='SIGNATURE'`,
        [principal.organizationId, assetId, image.type, asBytea(image.bytes)],
      );
    } else {
      const inserted = (
        await db.query<{ id: string }>(
          `INSERT INTO organization_assets(organization_id,kind,content_type,bytes,created_by)
 VALUES($1,'SIGNATURE',$2,$3,$4) RETURNING id`,
          [
            principal.organizationId,
            image.type,
            asBytea(image.bytes),
            principal.userId,
          ],
        )
      ).rows[0];
      assetId = inserted.id;
      await db.query(
        `UPDATE clinical_doctors SET signature_asset_id=$3,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2`,
        [principal.organizationId, current.id, assetId, principal.userId],
      );
    }
    await audit(db, principal, current.id, 'CLINICAL_DOCTOR_SIGNATURE_UPDATED', {
      content_type: image.type,
      bytes: image.bytes.length,
    });
    return getDoctor(db, principal, current.id);
  });
}
