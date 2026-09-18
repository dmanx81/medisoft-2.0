import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPatient } from '../features/patients/repository';
import { emptyPatient } from '../features/patients/validation';
import { createDoctor } from '../features/clinical/doctors';
import {
  applyTemplateToPrescription,
  cancelPrescription,
  createPrescription,
  downloadPrescriptionPdf,
  finalizePrescription,
  getPrescription,
  updatePrescription,
} from '../features/clinical/prescriptions';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from '../features/clinical/templates';
import { templateSchema } from '../features/clinical/validation';
import { ClinicalError } from '../features/clinical/types';
import type { Principal, Role } from '../lib/auth/permissions';

const migrations = [
  '001_foundation.sql',
  '002_patient_crm.sql',
  '003_lab_catalogue.sql',
  '004_lab_orders_specimens.sql',
  '005_lab_results.sql',
  '006_lab_reports.sql',
  '007_report_sharing.sql',
  '008_billing.sql',
  '009_billing_operations.sql',
  '010_clinical_prescriptions.sql',
  '011_prescription_templates.sql',
];

async function fixture() {
  const db = new PGlite();
  for (const name of migrations)
    await db.exec(
      await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'),
    );
  const principals: Principal[] = [];
  const extras: {
    patient: Awaited<ReturnType<typeof createPatient>>;
    doctorUserId: string;
  }[] = [];
  for (const slug of ['clinic-a', 'clinic-b']) {
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country,address,phone,email) VALUES($1,$1,'CLINIC','AL','1 Care Street','+355000','care@example.test') RETURNING id",
        [slug],
      )
    ).rows[0].id;
    const user = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Admin',$2,'unused','ORG_ADMIN') RETURNING id",
        [org, `${slug}-admin@example.test`],
      )
    ).rows[0].id;
    const principal: Principal = {
      userId: user,
      organizationId: org,
      name: 'Admin',
      organizationName: slug,
      role: 'ORG_ADMIN',
      sessionHash: 'test-session',
    };
    principals.push(principal);
    extras.push({
      patient: await createPatient(db, principal, {
        data: {
          ...emptyPatient,
          first_name: slug === 'clinic-a' ? 'Ada' : 'Other',
          last_name: slug === 'clinic-a' ? 'Patient' : 'Clinic',
          date_of_birth: '1990-01-01',
          sex: 'FEMALE',
        },
        acknowledgeDuplicates: true,
      }),
      doctorUserId: (
        await db.query<{ id: string }>(
          "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Doctor',$2,'unused','DOCTOR') RETURNING id",
          [org, `${slug}-doctor@example.test`],
        )
      ).rows[0].id,
    });
  }
  const [a, b] = principals;
  return {
    db,
    a,
    b,
    patientA: extras[0].patient,
    patientB: extras[1].patient,
    doctorUserA: extras[0].doctorUserId,
    doctorUserB: extras[1].doctorUserId,
  };
}

function asRole(principal: Principal, role: Role, userId = principal.userId): Principal {
  return { ...principal, role, userId };
}

const hasCode = (code: string) => (error: unknown) =>
  error instanceof ClinicalError && error.code === code;

function medication(
  name: string,
  extra: Record<string, string> = {},
) {
  return {
    medication_name: name,
    strength: extra.strength ?? '500 mg',
    form: extra.form ?? 'Capsule',
    dose: extra.dose ?? '1 capsule',
    route: extra.route ?? 'Oral',
    frequency: extra.frequency ?? '3 times daily',
    duration: extra.duration ?? '7 days',
    quantity: extra.quantity ?? '21 capsules',
    instructions: extra.instructions ?? 'Take after food',
  };
}

const tonsillitis = {
  name: 'Acute Tonsillitis',
  description: 'First-line outpatient therapy',
  category: 'ENT',
  items: [
    medication('Amoxicillin'),
    medication('Paracetamol', {
      form: 'Tablet',
      dose: '1 tablet',
      frequency: 'As needed',
      duration: '',
      quantity: '',
      instructions: 'Maximum 3/day',
    }),
  ],
};

async function staffDoctor(
  db: PGlite,
  principal: Principal,
  userId: string,
  display_name = 'Dr Elena Hoxha',
) {
  return createDoctor(db, principal, {
    user_id: userId,
    first_name: 'Elena',
    last_name: 'Hoxha',
    display_name,
    title: 'Dr',
    specialty: 'ENT',
    license_number: 'LIC-100',
  });
}

void test('template validation requires a name and reuses prescription medication fields', () => {
  assert.equal(templateSchema.safeParse({ name: '' }).success, false);
  const parsed = templateSchema.parse({
    name: 'Acute Tonsillitis',
    items: [medication('Amoxicillin')],
  });
  assert.equal(parsed.items[0].form, 'Capsule');
  assert.equal(parsed.items[0].dose, '1 capsule');
});

void test('templates are organization-scoped, searchable and hidden across tenants', async () => {
  const { db, a, b } = await fixture();
  try {
    const created = await createTemplate(db, a, tonsillitis);
    assert.equal(created.organization_id, a.organizationId);
    assert.equal(created.items.length, 2);
    assert.equal(created.items[0].medication_name, 'Amoxicillin');
    assert.equal(created.items[1].instructions, 'Maximum 3/day');
    const listed = await listTemplates(db, a, { query: 'Tonsillitis' });
    assert.equal(listed.total, 1);
    assert.equal(listed.templates[0].item_count, 2);
    await assert.rejects(getTemplate(db, b, created.id), hasCode('NOT_FOUND'));
    await assert.rejects(
      updateTemplate(db, b, created.id, {
        ...tonsillitis,
        version: created.version,
      }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(deleteTemplate(db, b, created.id), hasCode('NOT_FOUND'));
    await assert.rejects(duplicateTemplate(db, b, created.id), hasCode('NOT_FOUND'));
    assert.equal((await listTemplates(db, b, {})).total, 0);
  } finally {
    await db.close();
  }
});

void test('unauthorized roles cannot manage templates and doctors only see active ones', async () => {
  const { db, a } = await fixture();
  try {
    const created = await createTemplate(db, a, tonsillitis);
    const inactive = await updateTemplate(db, a, created.id, {
      ...tonsillitis,
      name: 'Retired pack',
      is_active: false,
      version: created.version,
    });
    const doctor = asRole(a, 'DOCTOR');
    const receptionist = asRole(a, 'RECEPTIONIST');
    await assert.rejects(createTemplate(db, doctor, tonsillitis), hasCode('FORBIDDEN'));
    await assert.rejects(
      updateTemplate(db, doctor, inactive.id, {
        ...tonsillitis,
        version: inactive.version,
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(deleteTemplate(db, doctor, inactive.id), hasCode('FORBIDDEN'));
    await assert.rejects(listTemplates(db, receptionist, {}), hasCode('FORBIDDEN'));
    const visible = await listTemplates(db, doctor, { status: 'INACTIVE' });
    assert.equal(visible.total, 0);
    await assert.rejects(getTemplate(db, doctor, inactive.id), hasCode('NOT_FOUND'));
    const restored = await updateTemplate(db, a, inactive.id, {
      ...tonsillitis,
      name: 'Acute Tonsillitis',
      is_active: true,
      version: inactive.version,
    });
    const active = await getTemplate(db, doctor, restored.id);
    assert.equal(active.name, 'Acute Tonsillitis');
    assert.equal(active.is_active, true);
  } finally {
    await db.close();
  }
});

void test('template item create, update, reorder, duplicate, activate and delete stay audited', async () => {
  const { db, a } = await fixture();
  try {
    const created = await createTemplate(db, a, tonsillitis);
    const reordered = await updateTemplate(db, a, created.id, {
      name: created.name,
      description: created.description,
      category: created.category,
      is_active: true,
      version: created.version,
      items: [
        medication('Paracetamol', {
          form: 'Tablet',
          dose: '1 tablet',
          frequency: 'As needed',
          instructions: 'Maximum 3/day',
        }),
        medication('Amoxicillin'),
        medication('Ibuprofen', { strength: '400 mg' }),
      ],
    });
    assert.equal(reordered.items.map((item) => item.medication_name).join(','),
      'Paracetamol,Amoxicillin,Ibuprofen');
    const copy = await duplicateTemplate(db, a, reordered.id);
    assert.equal(copy.name, 'Acute Tonsillitis (copy)');
    assert.equal(copy.items.length, 3);
    assert.notEqual(copy.id, reordered.id);
    assert.notEqual(copy.items[0].id, reordered.items[0].id);
    await assert.rejects(
      createTemplate(db, a, { ...tonsillitis, name: 'Acute Tonsillitis' }),
      hasCode('DUPLICATE_NAME'),
    );
    const deactivated = await updateTemplate(db, a, copy.id, {
      name: copy.name,
      description: copy.description,
      category: copy.category,
      is_active: false,
      items: copy.items.map(({ id: _id, sort_order: _order, ...item }) => item),
      version: copy.version,
    });
    assert.equal(deactivated.is_active, false);
    await deleteTemplate(db, a, deactivated.id);
    await assert.rejects(getTemplate(db, a, deactivated.id), hasCode('NOT_FOUND'));
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_type='PRESCRIPTION_TEMPLATE' ORDER BY occurred_at,id",
      )
    ).rows.map((row) => row.action);
    for (const action of [
      'PRESCRIPTION_TEMPLATE_CREATED',
      'PRESCRIPTION_TEMPLATE_UPDATED',
      'PRESCRIPTION_TEMPLATE_DUPLICATED',
      'PRESCRIPTION_TEMPLATE_DEACTIVATED',
      'PRESCRIPTION_TEMPLATE_DELETED',
    ])
      assert.ok(events.includes(action), action);
  } finally {
    await db.close();
  }
});

void test('applying a template copies independent medications into a draft prescription', async () => {
  const { db, a, b, patientA, doctorUserA } = await fixture();
  try {
    const doctor = await staffDoctor(db, a, doctorUserA);
    const template = await createTemplate(db, a, tonsillitis);
    const otherTemplate = await createTemplate(db, b, {
      name: 'Foreign pack',
      items: [medication('Cefalexin')],
    });
    const draft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [],
    });
    await assert.rejects(
      applyTemplateToPrescription(db, a, draft.id, {
        template_id: otherTemplate.id,
        version: draft.version,
      }),
      hasCode('NOT_FOUND'),
    );
    const applied = await applyTemplateToPrescription(db, a, draft.id, {
      template_id: template.id,
      version: draft.version,
    });
    assert.equal(applied.source_template_id, template.id);
    assert.equal(applied.items.length, 2);
    assert.equal(applied.items[0].medication_name, 'Amoxicillin');
    assert.equal(applied.items[1].medication_name, 'Paracetamol');
    assert.notEqual(applied.items[0].id, template.items[0].id);
    const edited = await updatePrescription(db, a, applied.id, {
      version: applied.version,
      items: [
        medication('Amoxicillin', { dose: '2 capsules' }),
        medication('Paracetamol', {
          form: 'Tablet',
          dose: '1 tablet',
          frequency: 'As needed',
          instructions: 'Maximum 3/day',
        }),
      ],
    });
    assert.equal(edited.items[0].dose, '2 capsules');
    const changed = await updateTemplate(db, a, template.id, {
      name: template.name,
      description: 'Changed later',
      category: 'ENT',
      is_active: true,
      version: template.version,
      items: [medication('Azithromycin')],
    });
    assert.equal(changed.items.length, 1);
    const unchanged = await getPrescription(db, a, edited.id);
    assert.equal(unchanged.items.length, 2);
    assert.equal(unchanged.items[0].medication_name, 'Amoxicillin');
    assert.equal(unchanged.items[0].dose, '2 capsules');
    const live = await createTemplate(db, a, {
      name: 'Sinusitis',
      items: [medication('Doxycycline')],
    });
    const fromTemplate = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      source_template_id: live.id,
      items: [medication('Copied')],
    });
    assert.equal(fromTemplate.source_template_id, live.id);
    assert.equal(fromTemplate.items[0].medication_name, 'Copied');
    await deleteTemplate(db, a, template.id);
    const surviving = await getPrescription(db, a, edited.id);
    assert.equal(surviving.items.length, 2);
    assert.equal(surviving.source_template_id, '');
    const frozen = await finalizePrescription(db, a, surviving.id, {
      version: surviving.version,
    });
    assert.equal(frozen.status, 'FINALIZED');
    assert.equal(frozen.items[0].medication_name, 'Amoxicillin');
    assert.equal(frozen.items[0].dose, '2 capsules');
    await assert.rejects(
      applyTemplateToPrescription(db, a, frozen.id, {
        template_id: live.id,
        version: frozen.version,
      }),
      hasCode('CONFLICT'),
    );
    await assert.rejects(
      createPrescription(db, a, {
        patient_id: patientA.id,
        doctor_id: doctor.id,
        source_template_id: otherTemplate.id,
        items: [medication('Amoxicillin')],
      }),
      hasCode('VALIDATION'),
    );
    await assert.rejects(
      createPrescription(db, a, {
        patient_id: patientA.id,
        doctor_id: doctor.id,
        source_template_id: template.id,
        items: [medication('Amoxicillin')],
      }),
      hasCode('VALIDATION'),
    );
    await assert.rejects(
      applyTemplateToPrescription(db, b, surviving.id, {
        template_id: live.id,
        version: surviving.version,
      }),
      hasCode('NOT_FOUND'),
    );
  } finally {
    await db.close();
  }
});

void test('finalized and cancelled prescriptions cannot be modified through templates', async () => {
  const { db, a, patientA, doctorUserA } = await fixture();
  try {
    const doctor = await staffDoctor(db, a, doctorUserA);
    const template = await createTemplate(db, a, tonsillitis);
    const draft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [medication('Amoxicillin')],
    });
    const issued = await finalizePrescription(db, a, draft.id, {
      version: draft.version,
    });
    await assert.rejects(
      applyTemplateToPrescription(db, a, issued.id, {
        template_id: template.id,
        version: issued.version,
      }),
      hasCode('CONFLICT'),
    );
    await assert.rejects(
      updatePrescription(db, a, issued.id, {
        version: issued.version,
        source_template_id: template.id,
        items: [medication('Changed')],
      }),
      hasCode('CONFLICT'),
    );
    const cancelledDraft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [medication('Ibuprofen')],
    });
    const cancelled = await cancelPrescription(db, a, cancelledDraft.id, {
      reason: 'Entered in error',
      version: cancelledDraft.version,
    });
    await assert.rejects(
      applyTemplateToPrescription(db, a, cancelled.id, {
        template_id: template.id,
        version: cancelled.version,
      }),
      hasCode('CONFLICT'),
    );
    const doctorUser = asRole(a, 'DOCTOR', doctor.user_id);
    const ownDraft = await createPrescription(db, doctorUser, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [],
    });
    const copied = await applyTemplateToPrescription(db, doctorUser, ownDraft.id, {
      template_id: template.id,
      version: ownDraft.version,
    });
    assert.equal(copied.items.length, 2);
    await assert.rejects(
      applyTemplateToPrescription(db, asRole(a, 'RECEPTIONIST'), copied.id, {
        template_id: template.id,
        version: copied.version,
      }),
      hasCode('FORBIDDEN'),
    );
  } finally {
    await db.close();
  }
});

void test('same-org doctors cannot apply templates to or cancel another doctor’s prescription', async () => {
  const { db, a, b, patientA, patientB, doctorUserA, doctorUserB } = await fixture();
  try {
    const doctorA = await staffDoctor(db, a, doctorUserA, 'Dr Alice');
    const doctorBUser = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Dr Bob',$2,'unused','DOCTOR') RETURNING id",
        [a.organizationId, 'bob-same-org@example.test'],
      )
    ).rows[0].id;
    const doctorB = await staffDoctor(db, a, doctorBUser, 'Dr Bob');
    const alice: Principal = {
      ...a,
      userId: doctorA.user_id,
      role: 'DOCTOR',
      name: doctorA.display_name,
    };
    const bob: Principal = {
      ...a,
      userId: doctorB.user_id,
      role: 'DOCTOR',
      name: doctorB.display_name,
    };
    const t1 = await createTemplate(db, a, tonsillitis);
    const t2 = await createTemplate(db, a, {
      name: 'Sinusitis pack',
      items: [medication('Doxycycline')],
    });
    const inactive = await createTemplate(db, a, {
      name: 'Retired pack',
      is_active: false,
      items: [medication('Cefalexin')],
    });
    const aliceVisible = await listTemplates(db, alice, { status: 'INACTIVE' });
    assert.equal(
      aliceVisible.templates.every((row) => row.is_active),
      true,
    );
    await assert.rejects(getTemplate(db, alice, inactive.id), hasCode('NOT_FOUND'));
    await assert.rejects(createTemplate(db, alice, tonsillitis), hasCode('FORBIDDEN'));
    const draft = await createPrescription(db, alice, {
      patient_id: patientA.id,
      doctor_id: doctorA.id,
      items: [],
    });
    const fromT1 = await applyTemplateToPrescription(db, alice, draft.id, {
      template_id: t1.id,
      version: draft.version,
    });
    assert.equal(fromT1.source_template_id, t1.id);
    assert.equal(fromT1.items.map((item) => item.medication_name).join(','),
      'Amoxicillin,Paracetamol');
    const replaced = await applyTemplateToPrescription(db, alice, fromT1.id, {
      template_id: t2.id,
      version: fromT1.version,
    });
    assert.equal(replaced.source_template_id, t2.id);
    assert.equal(replaced.items.length, 1);
    assert.equal(replaced.items[0].medication_name, 'Doxycycline');
    await assert.rejects(
      applyTemplateToPrescription(db, bob, replaced.id, {
        template_id: t1.id,
        version: replaced.version,
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      applyTemplateToPrescription(db, alice, replaced.id, {
        template_id: inactive.id,
        version: replaced.version,
      }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      applyTemplateToPrescription(db, a, replaced.id, {
        template_id: inactive.id,
        version: replaced.version,
      }),
      hasCode('CONFLICT'),
    );
    await assert.rejects(downloadPrescriptionPdf(db, alice, replaced.id), hasCode('CONFLICT'));
    const issued = await finalizePrescription(db, alice, replaced.id, {
      version: replaced.version,
    });
    const pdf = await downloadPrescriptionPdf(db, alice, issued.id);
    assert.equal(pdf.pdf.subarray(0, 4).toString(), '%PDF');
    await assert.rejects(
      applyTemplateToPrescription(db, alice, issued.id, {
        template_id: t1.id,
        version: issued.version,
      }),
      hasCode('CONFLICT'),
    );
    await assert.rejects(
      cancelPrescription(db, bob, issued.id, {
        reason: 'Not my prescription',
        version: issued.version,
      }),
      hasCode('FORBIDDEN'),
    );
    const cancelled = await cancelPrescription(db, alice, issued.id, {
      reason: 'Therapy changed',
      version: issued.version,
    });
    assert.equal(cancelled.status, 'CANCELLED');
    await assert.rejects(downloadPrescriptionPdf(db, alice, cancelled.id), hasCode('CONFLICT'));
    await assert.rejects(
      applyTemplateToPrescription(db, alice, cancelled.id, {
        template_id: t1.id,
        version: cancelled.version,
      }),
      hasCode('CONFLICT'),
    );
    await deleteTemplate(db, a, t2.id);
    const afterDelete = await getPrescription(db, a, cancelled.id);
    assert.equal(afterDelete.status, 'CANCELLED');
    assert.equal(afterDelete.items[0].medication_name, 'Doxycycline');
    assert.equal(afterDelete.source_template_id, '');
    await assert.rejects(
      applyTemplateToPrescription(db, bob, cancelled.id, {
        template_id: t1.id,
        version: afterDelete.version,
      }),
      hasCode('CONFLICT'),
    );
    const doctorAway = await staffDoctor(db, b, doctorUserB, 'Dr Away');
    const foreign = await createPrescription(db, b, {
      patient_id: patientB.id,
      doctor_id: doctorAway.id,
      items: [medication('Cefalexin')],
    });
    await assert.rejects(getTemplate(db, b, t1.id), hasCode('NOT_FOUND'));
    await assert.rejects(
      applyTemplateToPrescription(db, b, foreign.id, {
        template_id: t1.id,
        version: foreign.version,
      }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      applyTemplateToPrescription(db, alice, foreign.id, {
        template_id: t1.id,
        version: foreign.version,
      }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      cancelPrescription(db, alice, foreign.id, {
        reason: 'Cross-organization attempt',
        version: foreign.version,
      }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(downloadPrescriptionPdf(db, alice, foreign.id), hasCode('NOT_FOUND'));
  } finally {
    await db.close();
  }
});
