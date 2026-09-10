import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import {
  createSchema,
  updateSchema,
  searchSchema,
  patientIdSchema,
  patientSchema,
  fieldErrors,
  type PatientInput,
} from './validation';
import {
  PatientError,
  type Patient,
  type PatientPage,
  type DuplicateMatch,
  type PatientSummary,
  type PatientActivity,
} from './types';

const fields = Object.keys(patientSchema.shape) as (keyof PatientInput)[];
const columns = fields
  .map((field) => `COALESCE(p.${field}::text,'') AS ${field}`)
  .join(',');
const selectPatient = `p.id,p.organization_id,p.patient_number,p.version,p.created_by,p.updated_by,p.created_at::text,p.updated_at::text,${columns}`;
function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new PatientError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string) {
  if (!patientIdSchema.safeParse(id).success)
    throw new PatientError(404, 'NOT_FOUND', 'Patient not found.');
  return id;
}
function notFound(): never {
  throw new PatientError(404, 'NOT_FOUND', 'Patient not found.');
}
export async function getPatient(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<Patient> {
  permit(principal, 'patients:read');
  const result = await db.query<Patient>(
    `SELECT ${selectPatient} FROM patients p WHERE p.organization_id=$1 AND p.id=$2`,
    [principal.organizationId, idValue(id)],
  );
  return result.rows[0] ?? notFound();
}
export async function listPatients(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<PatientPage> {
  permit(principal, 'patients:read');
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success)
    throw new PatientError(
      400,
      'VALIDATION',
      'Check the search options.',
      fieldErrors(parsed.error),
    );
  const {
    query,
    page: requestedPage,
    pageSize,
    sort,
    direction,
    status,
  } = parsed.data;
  // Escape wildcard operators: a search term is literal text, not a SQL pattern.
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const national = query.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const phone = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, '') : '';
  const where = `p.organization_id=$1 AND ($2='ALL' OR p.status=$2) AND ($3='' OR
 (p.first_name || ' ' || p.last_name) ILIKE $4 OR p.patient_number ILIKE $4 OR p.email ILIKE $4
 OR ($5<>'' AND p.national_id_key=$5) OR ($6<>'' AND p.phone_key LIKE '%' || $6 || '%'))`;
  const values = [
    principal.organizationId,
    status,
    query,
    pattern,
    national,
    phone,
  ];
  const total = Number(
    (
      await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM patients p WHERE ${where}`,
        values,
      )
    ).rows[0].total,
  );
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(total / pageSize)),
  );
  const sorts = {
    name: 'lower(p.last_name),lower(p.first_name)',
    patient_number: 'substring(p.patient_number from 5)::bigint',
    date_of_birth: 'p.date_of_birth',
    updated_at: 'p.updated_at',
  };
  const order = sorts[sort]
    .split(',')
    .map(
      (column) =>
        `${column} ${direction === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`,
    )
    .join(',');
  const patients = (
    await db.query<PatientSummary>(
      `SELECT p.id,p.patient_number,p.first_name,p.last_name,COALESCE(p.date_of_birth::text,'') AS date_of_birth,
 COALESCE(p.phone,'') AS phone,COALESCE(p.email,'') AS email,p.status,p.updated_at::text
 FROM patients p WHERE ${where} ORDER BY ${order},p.id LIMIT $7 OFFSET $8`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { patients, total, page, pageSize };
}
async function duplicates(
  db: QueryRunner,
  principal: Principal,
  data: PatientInput,
  excludeId: string | null,
): Promise<DuplicateMatch[]> {
  const national = data.national_id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const phone = data.phone.replace(/\D/g, '');
  const rows = (
    await db.query<{
      id: string;
      patient_number: string;
      first_name: string;
      last_name: string;
      date_of_birth: string;
      national: boolean;
      name_dob: boolean;
      phone_match: boolean;
      email_match: boolean;
    }>(
      `SELECT p.id,p.patient_number,p.first_name,p.last_name,COALESCE(p.date_of_birth::text,'') AS date_of_birth,
 ($2<>'' AND p.national_id_key=$2) AS national,
 (lower(p.first_name)=lower($3) AND lower(p.last_name)=lower($4) AND p.date_of_birth=nullif($5,'')::date) AS name_dob,
 ($6<>'' AND p.phone_key=$6) AS phone_match,($7<>'' AND lower(p.email)=lower($7)) AS email_match
 FROM patients p WHERE p.organization_id=$1 AND ($8::uuid IS NULL OR p.id<>$8) AND
 (($2<>'' AND p.national_id_key=$2) OR (lower(p.first_name)=lower($3) AND lower(p.last_name)=lower($4) AND p.date_of_birth=nullif($5,'')::date)
 OR ($6<>'' AND p.phone_key=$6) OR ($7<>'' AND lower(p.email)=lower($7)))
 ORDER BY national DESC NULLS LAST,p.id LIMIT 10`,
      [
        principal.organizationId,
        national,
        data.first_name,
        data.last_name,
        data.date_of_birth,
        phone,
        data.email,
        excludeId,
      ],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    patient_number: row.patient_number,
    first_name: row.first_name,
    last_name: row.last_name,
    date_of_birth: row.date_of_birth,
    exactNationalId: !!row.national,
    reasons: [
      row.national ? 'National ID' : null,
      row.name_dob ? 'Name and birth date' : null,
      row.phone_match ? 'Phone' : null,
      row.email_match ? 'Email' : null,
    ].filter((v): v is string => v !== null),
  }));
}
async function checkDuplicates(
  db: QueryRunner,
  principal: Principal,
  data: PatientInput,
  excludeId: string | null,
  acknowledged: boolean,
) {
  const matches = await duplicates(db, principal, data, excludeId);
  if (matches.some((match) => match.exactNationalId))
    throw new PatientError(
      409,
      'NATIONAL_ID_DUPLICATE',
      'This national ID already belongs to a patient in your organization.',
      { national_id: 'Open the existing record or correct the national ID.' },
      matches,
    );
  if (matches.length && !acknowledged)
    throw new PatientError(
      409,
      'DUPLICATE_WARNING',
      'Possible matches found. Inspect them before continuing.',
      {},
      matches,
    );
}
async function audit(
  db: QueryRunner,
  principal: Principal,
  id: string,
  action: string,
  changedFields: string[],
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,'PATIENT',$4,$5::jsonb,$6)`,
    [
      principal.organizationId,
      principal.userId,
      action,
      id,
      JSON.stringify({ fields: changedFields }),
      principal.sessionHash,
    ],
  );
}
async function transaction<T>(
  db: QueryRunner,
  work: () => Promise<T>,
): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    if (error instanceof PatientError) throw error;
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === '23505'
    )
      throw new PatientError(
        409,
        'CONFLICT',
        'A matching patient identity was saved by another user. Refresh and inspect the existing record.',
      );
    throw error;
  }
}
// Mutations require a dedicated connection, exactly as the Phase 1 auth transactions do.
export async function createPatient(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<Patient> {
  permit(principal, 'patients:create');
  permit(principal, 'patients:read');
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    throw new PatientError(
      400,
      'VALIDATION',
      'Check the highlighted fields.',
      fieldErrors(parsed.error),
    );
  const { data, acknowledgeDuplicates } = parsed.data;
  return transaction(db, async () => {
    // Serialize the duplicate check and number allocation within this organization.
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
      principal.organizationId,
    ]);
    await checkDuplicates(db, principal, data, null, acknowledgeDuplicates);
    const counter = (
      await db.query<{ last_number: string }>(
        `INSERT INTO patient_counters(organization_id,last_number) VALUES($1,1)
   ON CONFLICT(organization_id) DO UPDATE SET last_number=patient_counters.last_number+1 RETURNING last_number::text`,
        [principal.organizationId],
      )
    ).rows[0].last_number;
    const values = [
      principal.organizationId,
      `PAT-${counter.padStart(6, '0')}`,
      principal.userId,
      ...fields.map((field) => data[field] || null),
    ];
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO patients(organization_id,patient_number,created_by,updated_by,${fields.join(',')})
   VALUES($1,$2,$3,$3,${fields.map((_, index) => `$${index + 4}`).join(',')}) RETURNING id`,
        values,
      )
    ).rows[0].id;
    await audit(
      db,
      principal,
      id,
      'PATIENT_CREATED',
      fields.filter((field) => !!data[field]),
    );
    return getPatient(db, principal, id);
  });
}
export async function updatePatient(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<Patient> {
  permit(principal, 'patients:edit');
  permit(principal, 'patients:read');
  idValue(id);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success)
    throw new PatientError(
      400,
      'VALIDATION',
      'Check the highlighted fields.',
      fieldErrors(parsed.error),
    );
  const { data, version, acknowledgeDuplicates } = parsed.data;
  return transaction(db, async () => {
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
      principal.organizationId,
    ]);
    const existing =
      (
        await db.query<Patient>(
          `SELECT ${selectPatient} FROM patients p WHERE p.organization_id=$1 AND p.id=$2 FOR UPDATE`,
          [principal.organizationId, id],
        )
      ).rows[0] ?? notFound();
    if (existing.version !== version)
      throw new PatientError(
        409,
        'STALE_VERSION',
        'This record changed while you were editing. Reload the latest record before saving.',
      );
    const changed = fields.filter((field) => existing[field] !== data[field]);
    if (!changed.length) return existing;
    if (
      changed.some((field) =>
        [
          'first_name',
          'last_name',
          'date_of_birth',
          'national_id',
          'phone',
          'email',
        ].includes(field),
      )
    )
      await checkDuplicates(db, principal, data, id, acknowledgeDuplicates);
    await db.query(
      `UPDATE patients SET ${fields.map((field, index) => `${field}=$${index + 4}`).join(',')},updated_by=$3,version=version+1 WHERE organization_id=$1 AND id=$2`,
      [
        principal.organizationId,
        id,
        principal.userId,
        ...fields.map((field) => data[field] || null),
      ],
    );
    await audit(db, principal, id, 'PATIENT_UPDATED', changed);
    if (changed.includes('status'))
      await audit(db, principal, id, 'PATIENT_STATUS_CHANGED', ['status']);
    return getPatient(db, principal, id);
  });
}
export async function patientActivity(
  db: QueryRunner,
  principal: Principal,
  id: string,
  page = 1,
) {
  permit(principal, 'patients:activity');
  await getPatient(db, principal, id);
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new PatientError(400, 'VALIDATION', 'Invalid activity page.');
  return (
    await db.query<PatientActivity>(
      `SELECT a.id,a.action,a.occurred_at::text,COALESCE(u.name,'Former team member') AS actor,a.metadata
 FROM audit_events a LEFT JOIN users u ON u.id=a.user_id AND u.organization_id=a.organization_id
 WHERE a.organization_id=$1 AND a.entity_type='PATIENT' AND a.entity_id=$2
 ORDER BY a.occurred_at DESC,a.id DESC LIMIT 21 OFFSET $3`,
      [principal.organizationId, id, (page - 1) * 20],
    )
  ).rows;
}
