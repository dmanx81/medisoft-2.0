import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { getPatient } from '@/features/patients/repository';
import { PatientError } from '@/features/patients/types';
import { getDoctor, getDoctorByUser } from '@/features/doctors/repository';
import { DoctorError } from '@/features/doctors/types';
import { medicationSummary } from './format';
import { renderPrescriptionPdf } from './pdf';
import { buildPrescriptionSnapshot, prescriptionFromSnapshot } from './snapshot';
import {
  cancelPrescriptionSchema,
  createPrescriptionSchema,
  fieldErrors,
  finalizePrescriptionSchema,
  prescriptionIdSchema,
  searchSchema,
  updatePrescriptionSchema,
} from './validation';
import {
  PrescriptionError,
  type Prescription,
  type PrescriptionItem,
  type PrescriptionItemInput,
  type PrescriptionPage,
  type PrescriptionSnapshot,
  type PrescriptionSummary,
} from './types';

type ItemInput = PrescriptionItemInput;

export const prescriptionSelect = `p.id,p.organization_id,p.patient_id,p.doctor_id,p.prescription_number,
 p.status,p.prescription_date::text,p.clinical_note,p.general_instructions,
 COALESCE(p.finalized_at::text,'') AS finalized_at,COALESCE(p.finalized_by::text,'') AS finalized_by,
 COALESCE(fb.name,'') AS finalized_by_name,COALESCE(p.cancelled_at::text,'') AS cancelled_at,
 COALESCE(p.cancelled_by::text,'') AS cancelled_by,COALESCE(cb.name,'') AS cancelled_by_name,
 p.cancellation_reason,p.created_at::text,p.updated_at::text,p.created_by,p.updated_by,p.version,
 p.snapshot,pt.patient_number,pt.first_name AS patient_first_name,pt.last_name AS patient_last_name,
 d.display_name AS doctor_display_name`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new PrescriptionError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string) {
  if (!prescriptionIdSchema.safeParse(id).success)
    throw new PrescriptionError(404, 'NOT_FOUND', 'Prescription not found.');
  return id;
}
function notFound(): never {
  throw new PrescriptionError(404, 'NOT_FOUND', 'Prescription not found.');
}
function invalid(error: Parameters<typeof fieldErrors>[0]): never {
  throw new PrescriptionError(
    400,
    'VALIDATION',
    'Check the highlighted fields.',
    fieldErrors(error),
  );
}
function stale(): never {
  throw new PrescriptionError(
    409,
    'STALE_VERSION',
    'This prescription changed. Reload and try again.',
  );
}
function parseSnapshot(
  value: PrescriptionSnapshot | Record<string, never> | string,
): PrescriptionSnapshot | Record<string, never> {
  return typeof value === 'string'
    ? (JSON.parse(value) as PrescriptionSnapshot)
    : value;
}
function clientSnapshot(
  snapshot: PrescriptionSnapshot | Record<string, never>,
): PrescriptionSnapshot | Record<string, never> {
  if (!('schema_version' in snapshot) || snapshot.schema_version !== 1)
    return {};
  return {
    ...snapshot,
    organization: {
      ...snapshot.organization,
      logo: snapshot.organization.logo
        ? {
            png_base64: '',
            width: snapshot.organization.logo.width,
            height: snapshot.organization.logo.height,
          }
        : null,
    },
    doctor: {
      ...snapshot.doctor,
      signature: snapshot.doctor.signature
        ? {
            png_base64: '',
            width: snapshot.doctor.signature.width,
            height: snapshot.doctor.signature.height,
          }
        : null,
    },
  };
}
function publicPrescription(row: Prescription, items: PrescriptionItem[]): Prescription {
  const snapshot = parseSnapshot(row.snapshot);
  const frozen =
    snapshot && 'schema_version' in snapshot && snapshot.schema_version === 1
      ? snapshot
      : null;
  return {
    ...row,
    version: Number(row.version),
    snapshot: clientSnapshot(snapshot),
    patient_number: frozen?.patient.patient_number || row.patient_number,
    patient_first_name: frozen?.patient.first_name || row.patient_first_name,
    patient_last_name: frozen?.patient.last_name || row.patient_last_name,
    doctor_display_name: frozen?.doctor.display_name || row.doctor_display_name,
    items: frozen
      ? frozen.items.map((item, index) => ({
          id: `${row.id}:${index}`,
          organization_id: row.organization_id,
          prescription_id: row.id,
          sort_order: item.sort_order,
          medication_name: item.medication_name,
          strength: item.strength,
          form: item.form,
          dose: item.dose,
          route: item.route,
          frequency: item.frequency,
          duration: item.duration,
          quantity: item.quantity,
          instructions: item.instructions,
        }))
      : items,
  };
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
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === '23505'
    )
      throw new PrescriptionError(
        409,
        'CONFLICT',
        'A prescription number collision occurred. Please retry.',
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
 VALUES($1,$2,$3,'PRESCRIPTION',$4,$5::jsonb,$6)`,
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
async function loadItems(
  db: QueryRunner,
  organizationId: string,
  prescriptionId: string,
): Promise<PrescriptionItem[]> {
  return (
    await db.query<PrescriptionItem>(
      `SELECT id,organization_id,prescription_id,sort_order,medication_name,strength,form,dose,route,
 frequency,duration,quantity,instructions
 FROM prescription_items
 WHERE organization_id=$1 AND prescription_id=$2
 ORDER BY sort_order,id`,
      [organizationId, prescriptionId],
    )
  ).rows.map((item) => ({ ...item, sort_order: Number(item.sort_order) }));
}
async function loadPrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<Prescription> {
  const row = (
    await db.query<Prescription>(
      `SELECT ${prescriptionSelect}
 FROM prescriptions p
 JOIN patients pt ON pt.organization_id=p.organization_id AND pt.id=p.patient_id
 JOIN doctors d ON d.organization_id=p.organization_id AND d.id=p.doctor_id
 LEFT JOIN users fb ON fb.organization_id=p.organization_id AND fb.id=p.finalized_by
 LEFT JOIN users cb ON cb.organization_id=p.organization_id AND cb.id=p.cancelled_by
 WHERE p.organization_id=$1 AND p.id=$2`,
      [principal.organizationId, id],
    )
  ).rows[0];
  if (!row) notFound();
  const items = await loadItems(db, principal.organizationId, row.id);
  return publicPrescription(row, items);
}
async function replaceItems(
  db: QueryRunner,
  principal: Principal,
  prescriptionId: string,
  items: ItemInput[],
) {
  await db.query(
    'DELETE FROM prescription_items WHERE organization_id=$1 AND prescription_id=$2',
    [principal.organizationId, prescriptionId],
  );
  for (const [index, item] of items.entries()) {
    await db.query(
      `INSERT INTO prescription_items(organization_id,prescription_id,sort_order,medication_name,strength,
 form,dose,route,frequency,duration,quantity,instructions)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        principal.organizationId,
        prescriptionId,
        index,
        item.medication_name,
        item.strength,
        item.form,
        item.dose,
        item.route,
        item.frequency,
        item.duration,
        item.quantity,
        item.instructions,
      ],
    );
  }
}
async function requirePatient(
  db: QueryRunner,
  principal: Principal,
  patientId: string,
) {
  try {
    return await getPatient(db, principal, patientId);
  } catch (error) {
    if (error instanceof PatientError && error.status === 404)
      throw new PrescriptionError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
    throw error;
  }
}
async function resolveDoctor(
  db: QueryRunner,
  principal: Principal,
  requestedId: string | undefined,
  requireActive: boolean,
) {
  if (principal.role === 'DOCTOR') {
    const mine = await getDoctorByUser(db, principal);
    if (!mine)
      throw new PrescriptionError(
        403,
        'DOCTOR_PROFILE_REQUIRED',
        'Your account does not have a doctor profile.',
      );
    if (requestedId && requestedId !== mine.id)
      throw new PrescriptionError(
        403,
        'FORBIDDEN',
        'You can only prescribe under your own doctor profile.',
      );
    if (requireActive && mine.status !== 'ACTIVE')
      throw new PrescriptionError(
        409,
        'DOCTOR_INACTIVE',
        'An inactive doctor cannot issue a new prescription.',
      );
    return mine;
  }
  if (!requestedId)
    throw new PrescriptionError(
      400,
      'VALIDATION',
      'Choose a prescribing doctor.',
      { doctor_id: 'Choose a prescribing doctor.' },
    );
  try {
    const doctor = await getDoctor(db, principal, requestedId);
    if (requireActive && doctor.status !== 'ACTIVE')
      throw new PrescriptionError(
        409,
        'DOCTOR_INACTIVE',
        'An inactive doctor cannot issue a new prescription.',
      );
    return doctor;
  } catch (error) {
    if (error instanceof DoctorError && error.status === 404)
      throw new PrescriptionError(404, 'DOCTOR_NOT_FOUND', 'Doctor not found.');
    throw error;
  }
}
async function allocatePrescriptionNumber(
  db: QueryRunner,
  organizationId: string,
) {
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
    organizationId,
  ]);
  const allocated = (
    await db.query<{ year: string; last_number: string }>(
      `INSERT INTO prescription_counters(organization_id,year,last_number)
 VALUES($1,EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::integer,1)
 ON CONFLICT(organization_id,year)
 DO UPDATE SET last_number=prescription_counters.last_number+1
 RETURNING year::text,last_number::text`,
      [organizationId],
    )
  ).rows[0];
  return `RX-${allocated.year}-${allocated.last_number.padStart(6, '0')}`;
}

export async function getPrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<Prescription> {
  permit(principal, 'prescriptions:read');
  return loadPrescription(db, principal, idValue(id));
}

export async function listPrescriptions(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<PrescriptionPage> {
  permit(principal, 'prescriptions:read');
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const { query, status, patient_id, page, pageSize } = parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `p.organization_id=$1 AND ($2='ALL' OR p.status=$2)
 AND ($3::uuid IS NULL OR p.patient_id=$3)
 AND ($4='' OR p.prescription_number ILIKE $5 ESCAPE '\\'
  OR d.display_name ILIKE $5 ESCAPE '\\'
  OR COALESCE(p.snapshot->'doctor'->>'display_name','') ILIKE $5 ESCAPE '\\')`;
  const values = [
    principal.organizationId,
    status,
    patient_id ?? null,
    query,
    pattern,
  ];
  const total = Number(
    (
      await db.query<{ count: string }>(
        `SELECT count(*)::text AS count
 FROM prescriptions p
 JOIN doctors d ON d.organization_id=p.organization_id AND d.id=p.doctor_id
 WHERE ${where}`,
        values,
      )
    ).rows[0].count,
  );
  const rows = (
    await db.query<
      PrescriptionSummary & { snapshot: PrescriptionSnapshot | string; live_summary: string }
    >(
      `SELECT p.id,p.patient_id,p.doctor_id,p.prescription_number,p.status,p.prescription_date::text,
 COALESCE(p.snapshot->'doctor'->>'display_name', d.display_name) AS doctor_display_name,
 COALESCE((
   SELECT string_agg(i.medication_name, ', ' ORDER BY i.sort_order)
   FROM (
     SELECT medication_name,sort_order FROM prescription_items
     WHERE organization_id=p.organization_id AND prescription_id=p.id
     ORDER BY sort_order LIMIT 3
   ) i
 ),'') AS live_summary,
 p.created_at::text,COALESCE(p.finalized_at::text,'') AS finalized_at,p.snapshot
 FROM prescriptions p
 JOIN doctors d ON d.organization_id=p.organization_id AND d.id=p.doctor_id
 WHERE ${where}
 ORDER BY COALESCE(p.finalized_at,p.created_at) DESC,p.id
 LIMIT $6 OFFSET $7`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return {
    prescriptions: rows.map((row) => {
      const snapshot = parseSnapshot(row.snapshot);
      const frozen =
        snapshot && 'schema_version' in snapshot ? snapshot.items : [];
      return {
        id: row.id,
        patient_id: row.patient_id,
        doctor_id: row.doctor_id,
        prescription_number: row.prescription_number,
        status: row.status,
        prescription_date: row.prescription_date,
        doctor_display_name: row.doctor_display_name,
        medication_summary:
          frozen.length > 0
            ? medicationSummary(frozen)
            : medicationSummary(
                row.live_summary
                  ? row.live_summary.split(', ').map((medication_name) => ({
                      medication_name,
                    }))
                  : [],
              ),
        created_at: row.created_at,
        finalized_at: row.finalized_at,
      };
    }),
    total,
    page,
    pageSize,
  };
}

export async function createPrescription(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<Prescription> {
  permit(principal, 'prescriptions:create');
  permit(principal, 'prescriptions:read');
  const parsed = createPrescriptionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  const patient = await requirePatient(db, principal, parsed.data.patient_id);
  const doctor = await resolveDoctor(db, principal, parsed.data.doctor_id, true);
  const date =
    parsed.data.prescription_date || new Date().toISOString().slice(0, 10);
  return transaction(db, async () => {
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO prescriptions(organization_id,patient_id,doctor_id,prescription_date,clinical_note,
 general_instructions,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$7)
 RETURNING id`,
        [
          principal.organizationId,
          patient.id,
          doctor.id,
          date,
          parsed.data.clinical_note,
          parsed.data.general_instructions,
          principal.userId,
        ],
      )
    ).rows[0];
    await replaceItems(db, principal, inserted.id, parsed.data.items);
    await audit(db, principal, inserted.id, 'PRESCRIPTION_CREATED', {
      patient_id: patient.id,
      doctor_id: doctor.id,
      item_count: parsed.data.items.length,
    });
    return loadPrescription(db, principal, inserted.id);
  });
}

export async function updatePrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<Prescription> {
  permit(principal, 'prescriptions:create');
  permit(principal, 'prescriptions:read');
  const parsed = updatePrescriptionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        doctor_id: string;
      }>(
        `SELECT id,status,version::text,doctor_id FROM prescriptions
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (locked.status !== 'DRAFT')
      throw new PrescriptionError(
        409,
        'NOT_DRAFT',
        'Only a draft prescription can be edited.',
      );
    const doctor = await resolveDoctor(
      db,
      principal,
      parsed.data.doctor_id || locked.doctor_id,
      true,
    );
    const previousItems = await loadItems(db, principal.organizationId, locked.id);
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE prescriptions SET doctor_id=$3,prescription_date=$4,clinical_note=$5,
 general_instructions=$6,updated_by=$7,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$8
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          doctor.id,
          parsed.data.prescription_date,
          parsed.data.clinical_note,
          parsed.data.general_instructions,
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await replaceItems(db, principal, locked.id, parsed.data.items);
    await audit(db, principal, locked.id, 'PRESCRIPTION_UPDATED', {
      doctor_id: doctor.id,
      item_count: parsed.data.items.length,
      previous_item_count: previousItems.length,
    });
    return loadPrescription(db, principal, locked.id);
  });
}

export async function finalizePrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<Prescription> {
  permit(principal, 'prescriptions:finalize');
  permit(principal, 'prescriptions:read');
  const parsed = finalizePrescriptionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        patient_id: string;
        doctor_id: string;
        prescription_date: string;
        clinical_note: string;
        general_instructions: string;
      }>(
        `SELECT id,status,version::text,patient_id,doctor_id,prescription_date::text,clinical_note,
 general_instructions
 FROM prescriptions WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (locked.status !== 'DRAFT')
      throw new PrescriptionError(
        409,
        'NOT_DRAFT',
        'Only a draft prescription can be finalized.',
      );
    const doctor = await resolveDoctor(db, principal, locked.doctor_id, true);
    if (principal.role === 'DOCTOR' && doctor.user_id !== principal.userId)
      throw new PrescriptionError(
        403,
        'FORBIDDEN',
        'You can only finalize your own prescriptions.',
      );
    const items = await loadItems(db, principal.organizationId, locked.id);
    if (items.length === 0)
      throw new PrescriptionError(
        409,
        'MEDICATION_REQUIRED',
        'Add at least one medication before finalizing.',
      );
    if (items.some((item) => !item.medication_name.trim()))
      throw new PrescriptionError(
        400,
        'VALIDATION',
        'Medication name cannot be blank.',
      );
    const number = await allocatePrescriptionNumber(
      db,
      principal.organizationId,
    );
    const finalizedAt = new Date().toISOString();
    const snapshot = await buildPrescriptionSnapshot(db, principal.organizationId, {
      patient_id: locked.patient_id,
      doctor_id: locked.doctor_id,
      prescription_number: number,
      prescription_date: locked.prescription_date,
      clinical_note: locked.clinical_note,
      general_instructions: locked.general_instructions,
      finalized_at: finalizedAt,
      finalized_by_name: principal.name,
      items,
    });
    const frozen = prescriptionFromSnapshot(snapshot);
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE prescriptions SET prescription_number=$3,status='FINALIZED',snapshot=$4::jsonb,
 finalized_at=$5,finalized_by=$6,updated_by=$6,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$7
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          number,
          JSON.stringify(frozen),
          finalizedAt,
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await audit(db, principal, locked.id, 'PRESCRIPTION_FINALIZED', {
      patient_id: locked.patient_id,
      doctor_id: locked.doctor_id,
      prescription_number: number,
      item_count: items.length,
    });
    return loadPrescription(db, principal, locked.id);
  });
}

export async function cancelPrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<Prescription> {
  permit(principal, 'prescriptions:cancel');
  permit(principal, 'prescriptions:read');
  const parsed = cancelPrescriptionSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{ id: string; status: string; version: string }>(
        `SELECT id,status,version::text FROM prescriptions
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (locked.status === 'CANCELLED')
      throw new PrescriptionError(
        409,
        'ALREADY_CANCELLED',
        'This prescription is already cancelled.',
      );
    if (locked.status !== 'DRAFT' && locked.status !== 'FINALIZED')
      throw new PrescriptionError(
        409,
        'INVALID_TRANSITION',
        'This prescription cannot be cancelled.',
      );
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE prescriptions SET status='CANCELLED',cancellation_reason=$3,cancelled_at=now(),
 cancelled_by=$4,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status=$5 AND version=$6
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          parsed.data.reason,
          principal.userId,
          locked.status,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await audit(db, principal, locked.id, 'PRESCRIPTION_CANCELLED', {
      previous_status: locked.status,
      reason: parsed.data.reason,
    });
    return loadPrescription(db, principal, locked.id);
  });
}

export async function downloadPrescriptionPdf(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<{ pdf: Buffer; filename: string; prescription: Prescription }> {
  permit(principal, 'prescriptions:download');
  permit(principal, 'prescriptions:read');
  const prescription = await loadPrescription(db, principal, idValue(id));
  const stored = (
    await db.query<{ snapshot: PrescriptionSnapshot | string }>(
      `SELECT snapshot FROM prescriptions WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, prescription.id],
    )
  ).rows[0];
  let snapshot: PrescriptionSnapshot;
  if (prescription.status === 'DRAFT') {
    snapshot = await buildPrescriptionSnapshot(db, principal.organizationId, {
      patient_id: prescription.patient_id,
      doctor_id: prescription.doctor_id,
      prescription_number: '',
      prescription_date: prescription.prescription_date,
      clinical_note: prescription.clinical_note,
      general_instructions: prescription.general_instructions,
      finalized_at: '',
      finalized_by_name: '',
      items: prescription.items,
    });
  } else {
    snapshot = prescriptionFromSnapshot(
      parseSnapshot(stored.snapshot) as PrescriptionSnapshot,
    );
  }
  const pdf = await renderPrescriptionPdf(snapshot, {
    draft: prescription.status === 'DRAFT',
    cancelled: prescription.status === 'CANCELLED',
  });
  const filename = `${prescription.prescription_number || 'draft-prescription'}.pdf`;
  await audit(db, principal, prescription.id, 'PRESCRIPTION_DOWNLOADED', {
    prescription_number: prescription.prescription_number,
    status: prescription.status,
  });
  return { pdf, filename, prescription };
}
