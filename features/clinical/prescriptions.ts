import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import {
  applyTemplateSchema,
  cancelSchema,
  fieldErrors,
  prescriptionDraftSchema,
  prescriptionIdSchema,
  prescriptionSearchSchema,
  prescriptionUpdateSchema,
} from './validation';
import {
  ClinicalError,
  type ClinicalPrescription,
  type PrescriptionItem,
  type PrescriptionPage,
  type PrescriptionSnapshotItem,
} from './types';
import { buildPrescriptionSnapshot, prescriptionFromSnapshot } from './snapshot';
import { renderPrescriptionPdf } from './pdf';
import { medicationSummary } from './format';
import { clinicalTransaction } from './transaction';
import { getTemplate, requireOwnedTemplate } from './templates';

const headerSelect = `p.id,p.organization_id,p.patient_id,p.doctor_id,p.status,p.prescription_number,
 p.prescribed_on::text,p.clinical_note,p.instructions,p.version,
 COALESCE(p.source_template_id::text,'') AS source_template_id,
 COALESCE(p.finalized_at::text,'') AS finalized_at,COALESCE(p.finalized_by::text,'') AS finalized_by,
 COALESCE(p.cancelled_at::text,'') AS cancelled_at,COALESCE(p.cancelled_by::text,'') AS cancelled_by,
 p.cancellation_reason,p.created_by,p.updated_by,p.created_at::text,p.updated_at::text,
 CASE WHEN p.prescription_number <> '' THEN COALESCE(p.snapshot->'patient'->>'patient_number', pt.patient_number)
  ELSE pt.patient_number END AS patient_number,
 CASE WHEN p.prescription_number <> '' THEN btrim(COALESCE(p.snapshot->'patient'->>'first_name','') || ' ' || COALESCE(p.snapshot->'patient'->>'last_name',''))
  ELSE btrim(pt.first_name || ' ' || pt.last_name) END AS patient_display,
 CASE WHEN p.prescription_number <> '' THEN COALESCE(p.snapshot->'doctor'->>'display_name', d.display_name)
  ELSE d.display_name END AS doctor_display`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new ClinicalError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}

function idValue(id: string) {
  if (!prescriptionIdSchema.safeParse(id).success)
    throw new ClinicalError(404, 'NOT_FOUND', 'Prescription not found.');
  return id;
}

function notFound(): never {
  throw new ClinicalError(404, 'NOT_FOUND', 'Prescription not found.');
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
 VALUES($1,$2,$3,'CLINICAL_PRESCRIPTION',$4,$5::jsonb,$6)`,
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
) {
  return (
    await db.query<PrescriptionItem>(
      `SELECT id,sort_order,medication_name,strength,form,dose,route,frequency,duration,quantity,instructions
 FROM clinical_prescription_items
 WHERE organization_id=$1 AND prescription_id=$2
 ORDER BY sort_order,id`,
      [organizationId, prescriptionId],
    )
  ).rows;
}

async function replaceItems(
  db: QueryRunner,
  organizationId: string,
  prescriptionId: string,
  items: PrescriptionSnapshotItem[],
) {
  await db.query(
    `DELETE FROM clinical_prescription_items WHERE organization_id=$1 AND prescription_id=$2`,
    [organizationId, prescriptionId],
  );
  for (const [index, item] of items.entries()) {
    await db.query(
      `INSERT INTO clinical_prescription_items(
 organization_id,prescription_id,sort_order,medication_name,strength,form,dose,route,frequency,duration,quantity,instructions)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        organizationId,
        prescriptionId,
        index + 1,
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

async function requireDoctor(
  db: QueryRunner,
  principal: Principal,
  doctorId: string,
  forFinalize: boolean,
) {
  const doctor = (
    await db.query<{ id: string; user_id: string; status: string }>(
      `SELECT id,user_id,status FROM clinical_doctors WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, doctorId],
    )
  ).rows[0];
  if (!doctor)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Select a doctor from this organization.',
      { doctor_id: 'Doctor was not found in this organization.' },
    );
  if (principal.role === 'DOCTOR' && doctor.user_id !== principal.userId)
    throw new ClinicalError(
      403,
      'FORBIDDEN',
      'You can only prescribe using your own doctor profile.',
      { doctor_id: 'Choose your own doctor profile.' },
    );
  if (forFinalize && doctor.status !== 'ACTIVE')
    throw new ClinicalError(
      409,
      'CONFLICT',
      'An inactive doctor cannot finalize a new prescription.',
      { doctor_id: 'Activate the doctor profile first.' },
    );
  return doctor;
}

async function requirePatient(
  db: QueryRunner,
  principal: Principal,
  patientId: string,
) {
  const patient = (
    await db.query<{ id: string }>(
      `SELECT id FROM patients WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, patientId],
    )
  ).rows[0];
  if (!patient)
    throw new ClinicalError(
      404,
      'NOT_FOUND',
      'Patient not found.',
      { patient_id: 'Patient was not found in this organization.' },
    );
}

export async function getPrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<ClinicalPrescription> {
  permit(principal, 'prescriptions:read');
  const row = (
    await db.query<Omit<ClinicalPrescription, 'items'>>(
      `SELECT ${headerSelect}
 FROM clinical_prescriptions p
 JOIN patients pt ON pt.organization_id=p.organization_id AND pt.id=p.patient_id
 JOIN clinical_doctors d ON d.organization_id=p.organization_id AND d.id=p.doctor_id
 WHERE p.organization_id=$1 AND p.id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  if (!row) notFound();
  return {
    ...row,
    items: await loadItems(db, principal.organizationId, row.id),
  };
}

export async function listPrescriptions(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<PrescriptionPage> {
  permit(principal, 'prescriptions:read');
  const parsed = prescriptionSearchSchema.safeParse(input ?? {});
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the search options.',
      fieldErrors(parsed.error),
    );
  const { query, patient_id, status, page, pageSize } = parsed.data;
  if (patient_id) await requirePatient(db, principal, patient_id);
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `p.organization_id=$1 AND ($2='' OR p.patient_id=$2::uuid)
 AND ($3='' OR p.status=$3) AND ($4='' OR p.prescription_number ILIKE $5 ESCAPE '\\'
 OR d.display_name ILIKE $5 ESCAPE '\\' OR pt.last_name ILIKE $5 ESCAPE '\\')`;
  const values = [
    principal.organizationId,
    patient_id ?? '',
    status,
    query,
    pattern,
  ];
  const total = Number(
    (
      await db.query<{ count: string }>(
        `SELECT count(*)::text AS count
 FROM clinical_prescriptions p
 JOIN patients pt ON pt.organization_id=p.organization_id AND pt.id=p.patient_id
 JOIN clinical_doctors d ON d.organization_id=p.organization_id AND d.id=p.doctor_id
 WHERE ${where}`,
        values,
      )
    ).rows[0]?.count ?? '0',
  );
  const rows = (
    await db.query<PrescriptionPage['prescriptions'][number] & { id: string }>(
      `SELECT p.id,p.prescription_number,p.status,p.prescribed_on::text,
 CASE WHEN p.prescription_number <> '' THEN COALESCE(p.snapshot->'doctor'->>'display_name', d.display_name)
  ELSE d.display_name END AS doctor_display,
 p.patient_id::text AS patient_id
 FROM clinical_prescriptions p
 JOIN patients pt ON pt.organization_id=p.organization_id AND pt.id=p.patient_id
 JOIN clinical_doctors d ON d.organization_id=p.organization_id AND d.id=p.doctor_id
 WHERE ${where}
 ORDER BY p.prescribed_on DESC,p.created_at DESC,p.id
 LIMIT $6 OFFSET $7`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  const prescriptions = [];
  for (const row of rows) {
    const items = await loadItems(db, principal.organizationId, row.id);
    prescriptions.push({
      ...row,
      medication_summary: medicationSummary(items),
    });
  }
  return { prescriptions, total, page, pageSize };
}

export async function createPrescription(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<ClinicalPrescription> {
  permit(principal, 'prescriptions:create');
  const parsed = prescriptionDraftSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the prescription details.',
      fieldErrors(parsed.error),
    );
  return clinicalTransaction(db, async () => {
    await requirePatient(db, principal, parsed.data.patient_id);
    await requireDoctor(db, principal, parsed.data.doctor_id, false);
    if (parsed.data.source_template_id)
      await requireOwnedTemplate(db, principal, parsed.data.source_template_id, {
        requireActive: true,
      });
    const prescribedOn =
      parsed.data.prescribed_on || new Date().toISOString().slice(0, 10);
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO clinical_prescriptions(
 organization_id,patient_id,doctor_id,prescribed_on,clinical_note,instructions,source_template_id,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [
          principal.organizationId,
          parsed.data.patient_id,
          parsed.data.doctor_id,
          prescribedOn,
          parsed.data.clinical_note,
          parsed.data.instructions,
          parsed.data.source_template_id ?? null,
          principal.userId,
        ],
      )
    ).rows[0];
    await replaceItems(
      db,
      principal.organizationId,
      inserted.id,
      parsed.data.items,
    );
    await audit(db, principal, inserted.id, 'CLINICAL_PRESCRIPTION_CREATED', {
      patient_id: parsed.data.patient_id,
      ...(parsed.data.source_template_id
        ? { source_template_id: parsed.data.source_template_id }
        : {}),
    });
    return getPrescription(db, principal, inserted.id);
  });
}

export async function updatePrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<ClinicalPrescription> {
  permit(principal, 'prescriptions:create');
  const parsed = prescriptionUpdateSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Check the prescription details.',
      fieldErrors(parsed.error),
    );
  return clinicalTransaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: number;
        doctor_id: string;
      }>(
        `SELECT id,status,version,doctor_id FROM clinical_prescriptions
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (locked.status !== 'DRAFT')
      throw new ClinicalError(
        409,
        'CONFLICT',
        'Only draft prescriptions can be edited.',
      );
    if (locked.version !== parsed.data.version)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    const doctorId = parsed.data.doctor_id ?? locked.doctor_id;
    await requireDoctor(db, principal, doctorId, false);
    if (parsed.data.source_template_id)
      await requireOwnedTemplate(db, principal, parsed.data.source_template_id, {
        requireActive: true,
      });
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE clinical_prescriptions SET
 doctor_id=$3,
 prescribed_on=CASE WHEN $4='' THEN prescribed_on ELSE $4::date END,
 clinical_note=COALESCE($5,clinical_note),
 instructions=COALESCE($6,instructions),
 source_template_id=CASE WHEN $9::uuid IS NULL THEN source_template_id ELSE $9::uuid END,
 updated_by=$7,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$8 AND status='DRAFT' RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          doctorId,
          parsed.data.prescribed_on ?? '',
          parsed.data.clinical_note,
          parsed.data.instructions,
          principal.userId,
          parsed.data.version,
          parsed.data.source_template_id ?? null,
        ],
      )
    ).rows[0];
    if (!updated)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    if (parsed.data.items)
      await replaceItems(db, principal.organizationId, locked.id, parsed.data.items);
    await audit(db, principal, locked.id, 'CLINICAL_PRESCRIPTION_UPDATED', {
      fields: [
        ...(parsed.data.items ? ['items'] : ['details']),
        ...(parsed.data.source_template_id ? ['source_template_id'] : []),
      ],
    });
    return getPrescription(db, principal, locked.id);
  });
}

export async function applyTemplateToPrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<ClinicalPrescription> {
  permit(principal, 'prescriptions:create');
  const parsed = applyTemplateSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Select a template to copy.',
      fieldErrors(parsed.error),
    );
  return clinicalTransaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: number;
        doctor_id: string;
      }>(
        `SELECT id,status,version,doctor_id FROM clinical_prescriptions
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (locked.status !== 'DRAFT')
      throw new ClinicalError(
        409,
        'CONFLICT',
        'Templates can only be applied to draft prescriptions.',
      );
    if (locked.version !== parsed.data.version)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    await requireDoctor(db, principal, locked.doctor_id, false);
    const templateLock = (
      await db.query<{ id: string; is_active: boolean }>(
        `SELECT id,is_active FROM prescription_templates
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, parsed.data.template_id],
      )
    ).rows[0];
    if (!templateLock)
      throw new ClinicalError(404, 'NOT_FOUND', 'Prescription template not found.');
    const template = await getTemplate(db, principal, templateLock.id);
    if (!template.is_active)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'Inactive templates cannot be applied to a prescription.',
      );
    await replaceItems(
      db,
      principal.organizationId,
      locked.id,
      template.items.map(({ id: _id, sort_order: _order, ...item }) => item),
    );
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE clinical_prescriptions SET source_template_id=$3,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$5 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          template.id,
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    await audit(db, principal, locked.id, 'CLINICAL_PRESCRIPTION_UPDATED', {
      fields: ['items', 'source_template_id'],
      source_template_id: template.id,
    });
    return getPrescription(db, principal, locked.id);
  });
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
      `INSERT INTO clinical_prescription_counters(organization_id,year,last_number)
 VALUES($1,EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::integer,1)
 ON CONFLICT(organization_id,year)
 DO UPDATE SET last_number=clinical_prescription_counters.last_number+1
 RETURNING year::text,last_number::text`,
      [organizationId],
    )
  ).rows[0];
  return `RX-${allocated.year}-${allocated.last_number.padStart(6, '0')}`;
}

export async function finalizePrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<ClinicalPrescription> {
  permit(principal, 'prescriptions:finalize');
  const version = (input as { version?: number } | null)?.version;
  if (!Number.isInteger(version) || (version ?? 0) < 1)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Reload the prescription and try again.',
      { version: 'A current version is required.' },
    );
  return clinicalTransaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: number;
        patient_id: string;
        doctor_id: string;
        prescribed_on: string;
        clinical_note: string;
        instructions: string;
      }>(
        `SELECT id,status,version,patient_id,doctor_id,prescribed_on::text,clinical_note,instructions
 FROM clinical_prescriptions WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (locked.status === 'FINALIZED')
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription is already finalized.',
      );
    if (locked.status !== 'DRAFT')
      throw new ClinicalError(
        409,
        'CONFLICT',
        'Only draft prescriptions can be finalized.',
      );
    if (locked.version !== version)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    await requireDoctor(db, principal, locked.doctor_id, true);
    const items = await loadItems(db, principal.organizationId, locked.id);
    if (!items.length)
      throw new ClinicalError(
        400,
        'VALIDATION',
        'Add at least one medication before finalizing.',
        { items: 'A prescription needs at least one medication.' },
      );
    const number = await allocatePrescriptionNumber(
      db,
      principal.organizationId,
    );
    const finalizedAt = new Date().toISOString();
    const snapshot = await buildPrescriptionSnapshot(db, principal, {
      prescription_number: number,
      prescribed_on: locked.prescribed_on,
      clinical_note: locked.clinical_note,
      instructions: locked.instructions,
      finalized_at: finalizedAt,
      finalized_by_name: principal.name,
      patient_id: locked.patient_id,
      doctor_id: locked.doctor_id,
      items: items.map(({ id: _id, sort_order: _order, ...item }) => item),
    });
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE clinical_prescriptions SET status='FINALIZED',prescription_number=$3,snapshot=$4::jsonb,
 finalized_at=$5::timestamptz,finalized_by=$6,updated_by=$6,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$7 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          number,
          JSON.stringify(snapshot),
          finalizedAt,
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    await audit(db, principal, locked.id, 'CLINICAL_PRESCRIPTION_FINALIZED', {
      prescription_number: number,
    });
    return getPrescription(db, principal, locked.id);
  });
}

export async function cancelPrescription(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<ClinicalPrescription> {
  permit(principal, 'prescriptions:cancel');
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success)
    throw new ClinicalError(
      400,
      'VALIDATION',
      'Provide a cancellation reason.',
      fieldErrors(parsed.error),
    );
  return clinicalTransaction(db, async () => {
    const locked = (
      await db.query<{ id: string; status: string; version: number }>(
        `SELECT id,status,version FROM clinical_prescriptions
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (locked.status === 'CANCELLED')
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription is already cancelled.',
      );
    if (locked.version !== parsed.data.version)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE clinical_prescriptions SET status='CANCELLED',cancellation_reason=$3,
 cancelled_at=now(),cancelled_by=$4,updated_by=$4,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$5 AND status <> 'CANCELLED' RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          parsed.data.reason,
          principal.userId,
          parsed.data.version,
        ],
      )
    ).rows[0];
    if (!updated)
      throw new ClinicalError(
        409,
        'CONFLICT',
        'This prescription was changed by someone else. Reload and try again.',
      );
    await audit(db, principal, locked.id, 'CLINICAL_PRESCRIPTION_CANCELLED', {
      from: locked.status,
    });
    return getPrescription(db, principal, locked.id);
  });
}

export async function downloadPrescriptionPdf(
  db: QueryRunner,
  principal: Principal,
  id: string,
) {
  permit(principal, 'prescriptions:download');
  const row = (
    await db.query<{
      status: string;
      snapshot: PrescriptionSnapshotItem & Record<string, unknown>;
      prescription_number: string;
    }>(
      `SELECT status,snapshot,prescription_number FROM clinical_prescriptions
 WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, idValue(id)],
    )
  ).rows[0];
  if (!row) notFound();
  if (row.status === 'DRAFT' || !row.prescription_number)
    throw new ClinicalError(
      409,
      'CONFLICT',
      'Finalize the prescription before printing.',
    );
  const snapshot = prescriptionFromSnapshot(
    row.snapshot as unknown as import('./types').PrescriptionSnapshot,
  );
  const pdf = await renderPrescriptionPdf(snapshot);
  await audit(db, principal, id, 'CLINICAL_PRESCRIPTION_DOWNLOADED', {
    prescription_number: row.prescription_number,
  });
  return { pdf, filename: `${row.prescription_number}.pdf` };
}
