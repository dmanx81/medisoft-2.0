import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { createPatient, updatePatient } from '../features/patients/repository';
import { emptyPatient } from '../features/patients/validation';
import {
  createDoctor,
  getDoctor,
  listDoctors,
  updateDoctor,
} from '../features/clinical/doctors';
import {
  cancelPrescription,
  createPrescription,
  downloadPrescriptionPdf,
  finalizePrescription,
  getPrescription,
  listPrescriptions,
  updatePrescription,
} from '../features/clinical/prescriptions';
import {
  getBranding,
  getOrganizationLogo,
  saveOrganizationLogo,
  updateBranding,
} from '../features/clinical/branding';
import { ClinicalError } from '../features/clinical/types';
import { pdfPageSize } from '../features/clinical/pdf';
import { doctorSchema } from '../features/clinical/validation';
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
  const extras: { patient: Awaited<ReturnType<typeof createPatient>> }[] = [];
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
    });
  }
  const [a, b] = principals;
  return { db, a, b, patientA: extras[0].patient, patientB: extras[1].patient };
}

function asRole(principal: Principal, role: Role): Principal {
  return { ...principal, role };
}

const hasCode = (code: string) => (error: unknown) =>
  error instanceof ClinicalError && error.code === code;

async function samplePng() {
  const create = sharp as unknown as (input: {
    create: {
      width: number;
      height: number;
      channels: number;
      background: { r: number; g: number; b: number };
    };
  }) => { png: () => { toBuffer: () => Promise<Buffer> } };
  return create({
    create: {
      width: 48,
      height: 48,
      channels: 3,
      background: { r: 15, g: 118, b: 110 },
    },
  })
    .png()
    .toBuffer();
}

function pdfText(buffer: Buffer) {
  const raw = buffer.toString('latin1');
  const parts: string[] = [];
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    if (match[1].length % 2 !== 0) continue;
    parts.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  for (const match of raw.matchAll(/\(([^\\()]{1,160})\)/g)) parts.push(match[1]);
  return parts.join('');
}

function pdfPageCount(buffer: Buffer) {
  return [...buffer.toString('latin1').matchAll(/\/Type\s*\/Page(?!s)/g)].length;
}

async function staffDoctor(
  db: PGlite,
  principal: Principal,
  patch: {
    email?: string;
    display_name?: string;
    first_name?: string;
    last_name?: string;
    title?: string;
    specialty?: string;
    license_number?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  } = {},
) {
  const email =
    patch.email ??
    `${principal.organizationName}-${Math.random().toString(16).slice(2)}@example.test`;
  const user = (
    await db.query<{ id: string }>(
      "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,$2,$3,'unused','DOCTOR') RETURNING id",
      [principal.organizationId, patch.display_name ?? 'Dr Example', email],
    )
  ).rows[0];
  return createDoctor(db, principal, {
    user_id: user.id,
    first_name: patch.first_name ?? 'Elena',
    last_name: patch.last_name ?? 'Hoxha',
    display_name: patch.display_name ?? 'Dr Elena Hoxha',
    title: patch.title ?? 'Dr',
    specialty: patch.specialty ?? 'Internal medicine',
    license_number: patch.license_number ?? 'LIC-100',
    status: patch.status ?? 'ACTIVE',
  });
}

function item(name: string, extra: Record<string, string> = {}) {
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

void test('doctor validation rejects empty names and accepts omitted staff ids', () => {
  assert.equal(
    doctorSchema.safeParse({ first_name: '', last_name: 'Hoxha' }).success,
    false,
  );
  assert.equal(
    doctorSchema.parse({
      first_name: 'Elena',
      last_name: 'Hoxha',
      user_id: '',
      email: 'elena@example.test',
    }).user_id,
    undefined,
  );
});

void test('doctors are organization staff, editable, deactivatable and tenant isolated', async () => {
  const { db, a, b } = await fixture();
  try {
    const doctor = await staffDoctor(db, a);
    assert.equal(doctor.organization_id, a.organizationId);
    assert.equal(doctor.status, 'ACTIVE');
    const listed = await listDoctors(db, a, { query: 'Hoxha' });
    assert.equal(listed.total, 1);
    const updated = await updateDoctor(db, a, doctor.id, {
      first_name: 'Elena',
      last_name: 'Hoxha',
      display_name: 'Dr Elena Hoxha',
      title: 'Dr',
      specialty: 'Cardiology',
      license_number: 'LIC-200',
      phone: '',
      professional_email: '',
      qualifications: 'MD',
      department: 'Cardiology',
      status: 'INACTIVE',
      version: doctor.version,
    });
    assert.equal(updated.status, 'INACTIVE');
    assert.equal(updated.specialty, 'Cardiology');
    assert.equal(updated.user_id, doctor.user_id);
    await assert.rejects(getDoctor(db, b, doctor.id), hasCode('NOT_FOUND'));
    await assert.rejects(
      updateDoctor(db, b, doctor.id, {
        ...updated,
        professional_email: updated.email,
        version: updated.version,
      }),
      hasCode('NOT_FOUND'),
    );
    assert.equal((await listDoctors(db, b, {})).total, 0);
    await assert.rejects(
      createDoctor(db, asRole(a, 'DOCTOR'), {
        first_name: 'No',
        last_name: 'Access',
        email: 'no-access@example.test',
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(db.exec('DELETE FROM clinical_doctors'), /cannot be deleted/);
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_type='CLINICAL_DOCTOR' AND entity_id=$1",
        [doctor.id],
      )
    ).rows.map((row) => row.action);
    assert.ok(events.includes('CLINICAL_DOCTOR_CREATED'));
    assert.ok(events.includes('CLINICAL_DOCTOR_DEACTIVATED'));
  } finally {
    await db.close();
  }
});

void test('prescription drafts, medications, finalization, immutability and numbering', async () => {
  const { db, a, b, patientA, patientB } = await fixture();
  try {
    const doctor = await staffDoctor(db, a);
    const doctorB = await staffDoctor(db, b, { display_name: 'Dr Other' });
    await assert.rejects(
      createPrescription(db, a, {
        patient_id: patientB.id,
        doctor_id: doctor.id,
        items: [item('Amoxicillin')],
      }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      createPrescription(db, a, {
        patient_id: patientA.id,
        doctor_id: doctorB.id,
        items: [item('Amoxicillin')],
      }),
      hasCode('VALIDATION'),
    );
    const draft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      clinical_note: 'Pharyngitis',
      items: [item('Amoxicillin')],
    });
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.prescription_number, '');
    assert.equal(draft.items.length, 1);
    const listedDraft = await listPrescriptions(db, a, { patient_id: patientA.id });
    assert.equal(listedDraft.total, 1);
    assert.equal(
      'clinical_note' in listedDraft.prescriptions[0],
      false,
    );
    const edited = await updatePrescription(db, a, draft.id, {
      version: draft.version,
      items: [item('Amoxicillin'), item('Ibuprofen', { strength: '400 mg' })],
    });
    assert.equal(edited.items.length, 2);
    await assert.rejects(
      finalizePrescription(db, asRole(a, 'RECEPTIONIST'), edited.id, {
        version: edited.version,
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      finalizePrescription(db, a, edited.id, { version: 0 }),
      hasCode('VALIDATION'),
    );
    const empty = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [],
    });
    await assert.rejects(
      finalizePrescription(db, a, empty.id, { version: empty.version }),
      hasCode('VALIDATION'),
    );
    const inactive = await staffDoctor(db, a, {
      display_name: 'Dr Inactive',
      status: 'INACTIVE',
      last_name: 'Inactive',
    });
    const blocked = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: inactive.id,
      items: [item('Amoxicillin')],
    });
    await assert.rejects(
      finalizePrescription(db, a, blocked.id, { version: blocked.version }),
      hasCode('CONFLICT'),
    );
    const first = await finalizePrescription(db, a, edited.id, {
      version: edited.version,
    });
    assert.equal(first.status, 'FINALIZED');
    assert.match(first.prescription_number, /^RX-20\d{2}-000001$/);
    await assert.rejects(
      updatePrescription(db, a, first.id, {
        version: first.version,
        clinical_note: 'changed',
      }),
      hasCode('CONFLICT'),
    );
    await assert.rejects(
      finalizePrescription(db, a, first.id, { version: first.version }),
      hasCode('CONFLICT'),
    );
    const secondDraft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [item('Azithromycin')],
    });
    const second = await finalizePrescription(db, a, secondDraft.id, {
      version: secondDraft.version,
    });
    assert.equal(second.prescription_number, first.prescription_number.replace('000001', '000002'));
    const otherOrg = await createPrescription(db, b, {
      patient_id: patientB.id,
      doctor_id: doctorB.id,
      items: [item('Cefalexin')],
    });
    const otherFinal = await finalizePrescription(db, b, otherOrg.id, {
      version: otherOrg.version,
    });
    assert.equal(otherFinal.prescription_number, first.prescription_number);
    await assert.rejects(getPrescription(db, b, first.id), hasCode('NOT_FOUND'));
    await assert.rejects(
      downloadPrescriptionPdf(db, b, first.id),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      listPrescriptions(db, b, { patient_id: patientA.id }),
      hasCode('NOT_FOUND'),
    );
    const cancelledDraft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [item('Paracetamol')],
    });
    const cancelled = await cancelPrescription(db, a, cancelledDraft.id, {
      reason: 'Entered in error',
      version: cancelledDraft.version,
    });
    assert.equal(cancelled.status, 'CANCELLED');
    await assert.rejects(
      updatePrescription(db, a, cancelled.id, { version: cancelled.version }),
      hasCode('CONFLICT'),
    );
    await assert.rejects(
      finalizePrescription(db, a, cancelled.id, { version: cancelled.version }),
      hasCode('CONFLICT'),
    );
    const revoked = await cancelPrescription(db, a, first.id, {
      reason: 'Therapy changed',
      version: first.version,
    });
    assert.equal(revoked.status, 'CANCELLED');
    assert.equal(revoked.prescription_number, first.prescription_number);
    await assert.rejects(
      db.query("UPDATE clinical_prescriptions SET status='DRAFT' WHERE id=$1", [
        revoked.id,
      ]),
      /cannot become active/,
    );
    await assert.rejects(db.exec('DELETE FROM clinical_prescriptions'), /cannot be deleted/);
    const concurrent = await Promise.all(
      [0, 1].map(async (index) => {
        const draftRx = await createPrescription(db, a, {
          patient_id: patientA.id,
          doctor_id: doctor.id,
          items: [item(`Concurrent-${index}`)],
        });
        return finalizePrescription(db, a, draftRx.id, { version: draftRx.version });
      }),
    );
    const numbers = new Set(concurrent.map((row) => row.prescription_number));
    assert.equal(numbers.size, 2);
    const doctorUser: Principal = {
      ...a,
      userId: doctor.user_id,
      role: 'DOCTOR',
      name: doctor.display_name,
    };
    await assert.rejects(
      createPrescription(db, doctorUser, {
        patient_id: patientA.id,
        doctor_id: inactive.id,
        items: [item('Amoxicillin')],
      }),
      hasCode('FORBIDDEN'),
    );
  } finally {
    await db.close();
  }
});

void test('cancelled prescriptions cannot print and only the owning doctor or admin can cancel', async () => {
  const { db, a, b, patientA, patientB } = await fixture();
  try {
    const doctorA = await staffDoctor(db, a, {
      display_name: 'Dr Alice',
      first_name: 'Alice',
      last_name: 'Own',
    });
    const doctorB = await staffDoctor(db, a, {
      display_name: 'Dr Bob',
      first_name: 'Bob',
      last_name: 'Other',
      email: 'bob-other@example.test',
    });
    const doctorOtherOrg = await staffDoctor(db, b, { display_name: 'Dr Away' });
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
    const draft = await createPrescription(db, alice, {
      patient_id: patientA.id,
      doctor_id: doctorA.id,
      items: [item('Amoxicillin')],
    });
    await assert.rejects(
      downloadPrescriptionPdf(db, alice, draft.id),
      hasCode('CONFLICT'),
    );
    const rxA = await finalizePrescription(db, alice, draft.id, {
      version: draft.version,
    });
    const validPdf = await downloadPrescriptionPdf(db, alice, rxA.id);
    assert.equal(validPdf.pdf.subarray(0, 4).toString(), '%PDF');
    const validText = pdfText(validPdf.pdf);
    assert.match(validText, /Amoxicillin/);
    assert.doesNotMatch(validText, /CANCELLED/);
    await assert.rejects(
      cancelPrescription(db, bob, rxA.id, {
        reason: 'Not my prescription',
        version: rxA.version,
      }),
      hasCode('FORBIDDEN'),
    );
    const stillFinal = await getPrescription(db, a, rxA.id);
    assert.equal(stillFinal.status, 'FINALIZED');
    const cancelledByOwner = await cancelPrescription(db, alice, rxA.id, {
      reason: 'Therapy changed',
      version: stillFinal.version,
    });
    assert.equal(cancelledByOwner.status, 'CANCELLED');
    await assert.rejects(
      downloadPrescriptionPdf(db, alice, cancelledByOwner.id),
      hasCode('CONFLICT'),
    );
    await assert.rejects(
      downloadPrescriptionPdf(db, a, cancelledByOwner.id),
      hasCode('CONFLICT'),
    );
    const adminDraft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctorA.id,
      items: [item('Ibuprofen')],
    });
    const adminRx = await finalizePrescription(db, a, adminDraft.id, {
      version: adminDraft.version,
    });
    const cancelledByAdmin = await cancelPrescription(db, a, adminRx.id, {
      reason: 'Administrative revocation',
      version: adminRx.version,
    });
    assert.equal(cancelledByAdmin.status, 'CANCELLED');
    const platformDraft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctorB.id,
      items: [item('Azithromycin')],
    });
    const platformRx = await finalizePrescription(db, a, platformDraft.id, {
      version: platformDraft.version,
    });
    const cancelledByPlatform = await cancelPrescription(
      db,
      asRole(a, 'PLATFORM_ADMIN'),
      platformRx.id,
      {
        reason: 'Platform administrative override',
        version: platformRx.version,
      },
    );
    assert.equal(cancelledByPlatform.status, 'CANCELLED');
    const foreignDraft = await createPrescription(db, b, {
      patient_id: patientB.id,
      doctor_id: doctorOtherOrg.id,
      items: [item('Cefalexin')],
    });
    const foreign = await finalizePrescription(db, b, foreignDraft.id, {
      version: foreignDraft.version,
    });
    await assert.rejects(
      cancelPrescription(db, a, foreign.id, {
        reason: 'Cross-organization attempt',
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
    await assert.rejects(
      downloadPrescriptionPdf(db, a, foreign.id),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      downloadPrescriptionPdf(db, alice, foreign.id),
      hasCode('NOT_FOUND'),
    );
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_type='CLINICAL_PRESCRIPTION' AND entity_id=$1",
        [cancelledByOwner.id],
      )
    ).rows.map((row) => row.action);
    assert.ok(events.includes('CLINICAL_PRESCRIPTION_CANCELLED'));
  } finally {
    await db.close();
  }
});

void test('finalized prescriptions render from frozen snapshots after live identity changes', async () => {
  const { db, a, patientA } = await fixture();
  try {
    const logo = await samplePng();
    await updateBranding(db, a, {
      legal_name: 'Care Centre A',
      address: '1 Care Street',
      city: 'Tirana',
      postal_code: '1001',
      phone: '+355000',
      email: 'care@example.test',
      website: 'https://care.example.test',
      registration_number: 'REG-1',
    });
    await saveOrganizationLogo(db, a, {
      type: 'image/png',
      bytes: logo,
      name: '../../logo.png',
    });
    const doctor = await staffDoctor(db, a, { license_number: 'LIC-FROZEN' });
    const draft = await createPrescription(db, a, {
      patient_id: patientA.id,
      doctor_id: doctor.id,
      items: [
        item('Amoxicillin'),
        ...Array.from({ length: 18 }, (_, index) =>
          item(`Long-line medication ${index + 1}`, {
            instructions: 'Continue this line onto additional A5 pages if needed. '.repeat(3),
          }),
        ),
      ],
    });
    const issued = await finalizePrescription(db, a, draft.id, {
      version: draft.version,
    });
    await updatePatient(db, a, patientA.id, {
      data: {
        ...emptyPatient,
        first_name: 'Renamed',
        last_name: 'LivePatient',
        date_of_birth: '1990-01-01',
        sex: 'FEMALE',
      },
      version: patientA.version,
    });
    await updateDoctor(db, a, doctor.id, {
      first_name: 'Changed',
      last_name: 'Doctor',
      display_name: 'Changed Doctor Live',
      title: 'Prof',
      specialty: 'Neurology',
      license_number: 'LIC-LIVE',
      phone: '',
      professional_email: '',
      qualifications: '',
      department: '',
      status: 'ACTIVE',
      version: doctor.version,
    });
    await db.query("UPDATE organizations SET name='Renamed Org Live',legal_name='Renamed Legal Live' WHERE id=$1", [
      a.organizationId,
    ]);
    const historical = await getPrescription(db, a, issued.id);
    assert.match(historical.patient_display ?? '', /Ada Patient/);
    assert.doesNotMatch(historical.patient_display ?? '', /Renamed/);
    assert.equal(historical.doctor_display, 'Dr Elena Hoxha');
    const { pdf, filename } = await downloadPrescriptionPdf(db, a, issued.id);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.equal(filename, `${issued.prescription_number}.pdf`);
    const size = pdfPageSize(pdf);
    assert.ok(Math.abs(size.width - 419.53) < 0.2);
    assert.ok(Math.abs(size.height - 595.28) < 0.2);
    assert.ok(pdfPageCount(pdf) >= 2);
    const text = pdfText(pdf);
    assert.match(text, /Ada/);
    assert.match(text, /Patient/);
    assert.match(text, /Dr Elena Hoxha/);
    assert.match(text, /Internal medicine/);
    assert.match(text, /LIC-FROZEN/);
    assert.match(text, /Amoxicillin/);
    assert.match(text, new RegExp(issued.prescription_number));
    assert.match(text, /Care Centre A/);
    assert.doesNotMatch(text, /Renamed Org Live/);
    assert.doesNotMatch(text, /Changed Doctor Live/);
    assert.doesNotMatch(text, /LIC-LIVE/);
    assert.match(text, /Long-line medication 18/);
    await assert.rejects(
      db.query("UPDATE clinical_prescriptions SET snapshot='{}'::jsonb WHERE id=$1", [
        issued.id,
      ]),
      /immutable/,
    );
    const branding = await getBranding(db, a);
    assert.equal(branding.has_logo, true);
    const storedLogo = await getOrganizationLogo(db, a);
    assert.equal(storedLogo.content_type, 'image/png');
    await assert.rejects(
      saveOrganizationLogo(db, a, {
        type: 'image/svg+xml',
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        name: 'x.svg',
      }),
      hasCode('VALIDATION'),
    );
    await assert.rejects(
      getBranding(db, asRole(a, 'DOCTOR')),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      getBranding(db, { ...a, organizationId: '00000000-0000-4000-8000-000000000099' }),
      hasCode('NOT_FOUND'),
    );
  } finally {
    await db.close();
  }
});
