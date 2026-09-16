import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { createPatient } from '../features/patients/repository';
import { emptyPatient } from '../features/patients/validation';
import { createDoctor, updateDoctor } from '../features/doctors/repository';
import { updateBranding, upsertLogo } from '../features/branding/repository';
import {
  cancelPrescription,
  createPrescription,
  downloadPrescriptionPdf,
  finalizePrescription,
  getPrescription,
  listPrescriptions,
  updatePrescription,
} from '../features/prescriptions/repository';
import { PrescriptionError } from '../features/prescriptions/types';
import { renderPrescriptionPdf } from '../features/prescriptions/pdf';
import type { Principal } from '../lib/auth/permissions';

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
];

const amoxicillin = {
  medication_name: 'Amoxicillin',
  strength: '500 mg',
  form: 'Capsule',
  dose: '1 capsule',
  route: 'Oral',
  frequency: '3 times daily',
  duration: '7 days',
  quantity: '21 capsules',
  instructions: 'Take after food',
};

function pdfText(buffer: Buffer) {
  const raw = buffer.toString('latin1');
  const parts: string[] = [];
  for (const match of raw.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    if (match[1].length % 2 !== 0) continue;
    parts.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  for (const match of raw.matchAll(/\(([^\\()]{1,160})\)/g)) {
    parts.push(match[1]);
  }
  return parts.join('');
}

async function png(color = '#0F766E') {
  return sharp({
    create: { width: 160, height: 64, channels: 3, background: color },
  })
    .png()
    .toBuffer();
}

async function setup() {
  const db = new PGlite();
  for (const name of migrations)
    await db.exec(
      await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'),
    );
  const orgs: Principal[] = [];
  const extras: {
    patient: string;
    doctor: string;
    doctorUser: string;
    technician: Principal;
  }[] = [];
  for (const slug of ['rx-a', 'rx-b']) {
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country,address,phone,email) VALUES($1,$1,'CLINIC','AL','1 Health Street','+355000','org@example.test') RETURNING id",
        [slug],
      )
    ).rows[0].id;
    const adminId = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Admin',$2,'unused','ORG_ADMIN') RETURNING id",
        [org, `${slug}-admin@example.test`],
      )
    ).rows[0].id;
    const doctorUser = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Dr Live',$2,'unused','DOCTOR') RETURNING id",
        [org, `${slug}-doctor@example.test`],
      )
    ).rows[0].id;
    const techId = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Tech',$2,'unused','LAB_TECHNICIAN') RETURNING id",
        [org, `${slug}-tech@example.test`],
      )
    ).rows[0].id;
    const admin: Principal = {
      userId: adminId,
      organizationId: org,
      role: 'ORG_ADMIN',
      name: 'Admin',
      organizationName: slug,
      sessionHash: 'test',
    };
    const doctorPrincipal: Principal = {
      userId: doctorUser,
      organizationId: org,
      role: 'DOCTOR',
      name: 'Dr Live',
      organizationName: slug,
      sessionHash: 'test',
    };
    orgs.push(admin, doctorPrincipal);
    const patient = await createPatient(db, admin, {
      data: {
        ...emptyPatient,
        first_name: `${slug}-Pat`,
        last_name: 'Patient',
        date_of_birth: '1988-04-12',
        sex: 'FEMALE',
      },
      acknowledgeDuplicates: true,
    });
    const doctor = await createDoctor(db, admin, {
      user_id: doctorUser,
      first_name: 'Live',
      last_name: 'Doctor',
      title: 'Dr',
      specialty: 'Family medicine',
      license_number: `${slug}-LIC`,
      status: 'ACTIVE',
    });
    extras.push({
      patient: patient.id,
      doctor: doctor.id,
      doctorUser,
      technician: {
        userId: techId,
        organizationId: org,
        role: 'LAB_TECHNICIAN',
        name: 'Tech',
        organizationName: slug,
        sessionHash: 'test',
      },
    });
  }
  return { db, orgs, extras };
}

void test('prescription lifecycle, immutability, numbering, isolation and A5 PDFs', async () => {
  const { db, orgs, extras } = await setup();
  try {
    const adminA = orgs[0];
    const doctorA = orgs[1];
    const adminB = orgs[2];
    const a = extras[0];
    const b = extras[1];
    await updateBranding(db, adminA, {
      name: 'Alpha Clinic',
      legal_name: 'Alpha Clinic sh.p.k.',
      address: '10 Care Road',
      city: 'Tirana',
      postal_code: '1000',
      country: 'AL',
      phone: '+355100',
      email: 'alpha@example.test',
      website: 'https://alpha.example',
      registration_number: 'REG-A',
    });
    await upsertLogo(db, adminA, { bytes: await png(), filename: 'logo.png' });

    const draft = await createPrescription(db, doctorA, {
      patient_id: a.patient,
      items: [amoxicillin],
      clinical_note: 'Pharyngitis',
      general_instructions: 'Complete the course',
    });
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.prescription_number, '');
    assert.equal(draft.doctor_id, a.doctor);
    assert.equal(draft.items[0].medication_name, 'Amoxicillin');

    const edited = await updatePrescription(db, doctorA, draft.id, {
      prescription_date: draft.prescription_date,
      clinical_note: 'Acute pharyngitis',
      general_instructions: 'Complete the course',
      items: [
        amoxicillin,
        {
          ...amoxicillin,
          medication_name: 'Ibuprofen',
          strength: '400 mg',
          quantity: '10 tablets',
        },
      ],
      version: draft.version,
    });
    assert.equal(edited.items.length, 2);

    await assert.rejects(
      () =>
        finalizePrescription(db, extras[0].technician, draft.id, {
          version: edited.version,
        }),
      (error: unknown) =>
        error instanceof PrescriptionError && error.status === 403,
    );

    const empty = await createPrescription(db, adminA, {
      patient_id: a.patient,
      doctor_id: a.doctor,
    });
    await assert.rejects(
      () => finalizePrescription(db, adminA, empty.id, { version: empty.version }),
      (error: unknown) =>
        error instanceof PrescriptionError && error.code === 'MEDICATION_REQUIRED',
    );

    const inactiveDoctor = await createDoctor(db, adminA, {
      user_id: adminA.userId,
      first_name: 'Inactive',
      last_name: 'Clinician',
      status: 'ACTIVE',
    });
    await updateDoctor(db, adminA, inactiveDoctor.id, {
      first_name: 'Inactive',
      last_name: 'Clinician',
      display_name: 'Inactive Clinician',
      title: '',
      specialty: '',
      license_number: '',
      phone: '',
      email: '',
      qualifications: '',
      department: '',
      status: 'INACTIVE',
      version: inactiveDoctor.version,
    });
    await assert.rejects(
      () =>
        createPrescription(db, adminA, {
          patient_id: a.patient,
          doctor_id: inactiveDoctor.id,
          items: [amoxicillin],
        }),
      (error: unknown) =>
        error instanceof PrescriptionError && error.code === 'DOCTOR_INACTIVE',
    );

    const finalized = await finalizePrescription(db, doctorA, edited.id, {
      version: edited.version,
    });
    assert.equal(finalized.status, 'FINALIZED');
    assert.match(finalized.prescription_number, /^RX-\d{4}-\d{6}$/);
    const audits = (
      await db.query<{ action: string }>(
        `SELECT action FROM audit_events WHERE organization_id=$1 AND entity_id=$2 ORDER BY occurred_at`,
        [adminA.organizationId, finalized.id],
      )
    ).rows.map((row) => row.action);
    assert.ok(audits.includes('PRESCRIPTION_CREATED'));
    assert.ok(audits.includes('PRESCRIPTION_UPDATED'));
    assert.ok(audits.includes('PRESCRIPTION_FINALIZED'));
    assert.equal(finalized.snapshot && 'schema_version' in finalized.snapshot, true);

    await assert.rejects(
      () =>
        updatePrescription(db, doctorA, finalized.id, {
          prescription_date: finalized.prescription_date,
          clinical_note: 'changed',
          general_instructions: '',
          items: [amoxicillin],
          version: finalized.version,
        }),
      (error: unknown) =>
        error instanceof PrescriptionError && error.code === 'NOT_DRAFT',
    );
    await assert.rejects(
      () =>
        finalizePrescription(db, doctorA, finalized.id, {
          version: finalized.version,
        }),
      (error: unknown) =>
        error instanceof PrescriptionError && error.code === 'NOT_DRAFT',
    );

    const second = await createPrescription(db, adminA, {
      patient_id: a.patient,
      doctor_id: a.doctor,
      items: [amoxicillin],
    });
    const secondFinal = await finalizePrescription(db, adminA, second.id, {
      version: second.version,
    });
    assert.notEqual(secondFinal.prescription_number, finalized.prescription_number);
    const year = new Date().getFullYear();
    assert.equal(finalized.prescription_number.startsWith(`RX-${year}-`), true);

    await db.query(
      "UPDATE patients SET first_name='Changed', last_name='Name' WHERE id=$1",
      [a.patient],
    );
    await db.query(
      "UPDATE doctors SET display_name='Changed Doctor', specialty='Neurology', license_number='CHANGED' WHERE id=$1",
      [a.doctor],
    );
    await db.query(
      "UPDATE organizations SET name='Renamed Org', legal_name='Renamed Legal' WHERE id=$1",
      [adminA.organizationId],
    );
    const historical = await getPrescription(db, adminA, finalized.id);
    assert.equal(historical.patient_first_name, `${adminA.organizationName}-Pat`);
    assert.notEqual(historical.doctor_display_name, 'Changed Doctor');
    const { pdf, filename } = await downloadPrescriptionPdf(db, adminA, finalized.id);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.equal(filename, `${finalized.prescription_number}.pdf`);
    assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 419\.53 595\.28\]/);
    const text = pdfText(pdf);
    assert.match(text, /Alpha Clinic/);
    assert.match(text, /PRESCRIPTION/);
    assert.ok(text.includes(finalized.prescription_number.replace(/-/g, '')) || text.includes('RX-'));
    assert.match(text, /Amoxicillin/);
    assert.match(text, /Ada|Live Doctor|Dr Live|Family/);
    assert.doesNotMatch(text, /Changed Doctor/);
    assert.doesNotMatch(text, /Renamed Legal/);

    const longItems = Array.from({ length: 12 }, (_, index) => ({
      ...amoxicillin,
      medication_name: `Medication ${index + 1} with a descriptive clinical label`,
      instructions:
        'Detailed instructions that must wrap across multiple lines without being clipped from the A5 page during overflow pagination.',
    }));
    const multi = await createPrescription(db, adminA, {
      patient_id: a.patient,
      doctor_id: a.doctor,
      items: longItems,
    });
    const multiFinal = await finalizePrescription(db, adminA, multi.id, {
      version: multi.version,
    });
    const multiPdf = await downloadPrescriptionPdf(db, adminA, multiFinal.id);
    const pageBoxes = [...multiPdf.pdf.toString('latin1').matchAll(/\/MediaBox \[0 0 419\.53 595\.28\]/g)];
    assert.ok(pageBoxes.length >= 2);
    const multiText = pdfText(multiPdf.pdf);
    assert.match(multiText, /Medication 1/);
    assert.match(multiText, /Medication 12/);
    assert.match(multiText, /Page/);

    await assert.rejects(
      () => getPrescription(db, adminB, finalized.id),
      (error: unknown) =>
        error instanceof PrescriptionError && error.status === 404,
    );
    await assert.rejects(
      () => downloadPrescriptionPdf(db, adminB, finalized.id),
      (error: unknown) =>
        error instanceof PrescriptionError && error.status === 404,
    );
    await assert.rejects(
      () =>
        createPrescription(db, adminB, {
          patient_id: a.patient,
          doctor_id: b.doctor,
          items: [amoxicillin],
        }),
      (error: unknown) =>
        error instanceof PrescriptionError && error.status === 404,
    );

    const cancelledDraft = await cancelPrescription(db, adminA, empty.id, {
      reason: 'Entered on the wrong patient',
      version: empty.version,
    });
    assert.equal(cancelledDraft.status, 'CANCELLED');
    const revoked = await cancelPrescription(db, adminA, finalized.id, {
      reason: 'Clinician revoked after review',
      version: finalized.version,
    });
    assert.equal(revoked.status, 'CANCELLED');
    assert.equal(revoked.prescription_number, finalized.prescription_number);
    await assert.rejects(
      () =>
        cancelPrescription(db, adminA, revoked.id, {
          reason: 'again',
          version: revoked.version,
        }),
      (error: unknown) =>
        error instanceof PrescriptionError && error.code === 'ALREADY_CANCELLED',
    );
    await assert.rejects(
      db.query('DELETE FROM prescriptions WHERE id=$1', [finalized.id]),
      /not deleted/,
    );

    const listed = await listPrescriptions(db, adminA, { patient_id: a.patient });
    assert.ok(listed.prescriptions.length >= 2);
    assert.ok(!JSON.stringify(listed).includes('Acute pharyngitis'));

    const snapshotPdf = await renderPrescriptionPdf(
      historical.snapshot && 'schema_version' in historical.snapshot
        ? {
            ...historical.snapshot,
            organization: {
              ...historical.snapshot.organization,
              logo: null,
            },
            doctor: { ...historical.snapshot.doctor, signature: null },
          }
        : (await getPrescription(db, adminA, secondFinal.id)).snapshot as never,
    );
    assert.equal(snapshotPdf.subarray(0, 4).toString(), '%PDF');
  } finally {
    await db.close();
  }
});
