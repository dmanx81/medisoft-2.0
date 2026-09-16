import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { solidPng } from '../features/branding/assets';
import { createPatient } from '../features/patients/repository';
import { emptyPatient } from '../features/patients/validation';
import {
  createDoctor,
  getDoctor,
  listDoctors,
  listStaffCandidates,
  updateDoctor,
  upsertDoctorSignature,
} from '../features/doctors/repository';
import { DoctorError } from '../features/doctors/types';
import {
  clearLogo,
  getBranding,
  updateBranding,
  upsertLogo,
} from '../features/branding/repository';
import { BrandingError } from '../features/branding/types';
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
];

async function png() {
  return solidPng();
}

async function fixture() {
  const db = new PGlite();
  for (const name of migrations)
    await db.exec(
      await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'),
    );
  const principals: Principal[] = [];
  for (const slug of ['clinic-a', 'clinic-b']) {
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country) VALUES($1,$1,'CLINIC','AL') RETURNING id",
        [slug],
      )
    ).rows[0].id;
    const admin = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Admin',$2,'unused','ORG_ADMIN') RETURNING id",
        [org, `${slug}-admin@example.test`],
      )
    ).rows[0].id;
    const doctorUser = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Clinician',$2,'unused','DOCTOR') RETURNING id",
        [org, `${slug}-doctor@example.test`],
      )
    ).rows[0].id;
    principals.push({
      userId: admin,
      organizationId: org,
      role: 'ORG_ADMIN',
      name: 'Admin',
      organizationName: slug,
      sessionHash: 'test',
    });
    principals.push({
      userId: doctorUser,
      organizationId: org,
      role: 'DOCTOR',
      name: 'Clinician',
      organizationName: slug,
      sessionHash: 'test',
    });
  }
  return { db, principals };
}

void test('doctors are organization staff profiles with RBAC, isolation and no hard delete', async () => {
  const { db, principals } = await fixture();
  try {
    const [adminA, doctorA, adminB] = principals;
    const created = await createDoctor(db, adminA, {
      user_id: doctorA.userId,
      first_name: 'Ada',
      last_name: 'Leku',
      display_name: '',
      title: 'Dr',
      specialty: 'Internal medicine',
      license_number: 'LIC-100',
      phone: '+355000',
      email: 'ada@example.test',
      qualifications: 'MD',
      department: 'Outpatients',
      status: 'ACTIVE',
    });
    assert.equal(created.display_name, 'Dr Ada Leku');
    assert.equal(created.user_id, doctorA.userId);
    const listed = await listDoctors(db, adminA, {});
    assert.equal(listed.total, 1);
    const updated = await updateDoctor(db, adminA, created.id, {
      first_name: 'Ada',
      last_name: 'Leku',
      display_name: 'Dr Ada Leku',
      title: 'Dr',
      specialty: 'Cardiology',
      license_number: 'LIC-100',
      phone: '+355000',
      email: 'ada@example.test',
      qualifications: 'MD',
      department: 'Cardiology',
      status: 'INACTIVE',
      version: created.version,
    });
    assert.equal(updated.specialty, 'Cardiology');
    assert.equal(updated.status, 'INACTIVE');
    await upsertDoctorSignature(db, adminA, created.id, {
      bytes: await png(),
      filename: 'sign.png',
    });
    assert.equal((await getDoctor(db, adminA, created.id)).has_signature, true);
    await assert.rejects(
      () => createDoctor(db, doctorA, {
        user_id: doctorA.userId,
        first_name: 'Ada',
        last_name: 'Leku',
        status: 'ACTIVE',
      }),
      (error: unknown) => error instanceof DoctorError && error.status === 403,
    );
    await assert.rejects(
      () => getDoctor(db, adminB, created.id),
      (error: unknown) => error instanceof DoctorError && error.status === 404,
    );
    await assert.rejects(
      db.query('DELETE FROM doctors WHERE id=$1', [created.id]),
      /not deleted/,
    );
    const candidates = await listStaffCandidates(db, adminA);
    assert.equal(
      candidates.some((row) => row.id === doctorA.userId),
      false,
    );
    const viewer: Principal = { ...adminA, role: 'VIEWER' as Role };
    await assert.rejects(
      () => listDoctors(db, viewer, {}),
      (error: unknown) => error instanceof DoctorError && error.status === 403,
    );
  } finally {
    await db.close();
  }
});

void test('organization branding and logo uploads are tenant-scoped and type-safe', async () => {
  const { db, principals } = await fixture();
  try {
    const [adminA, , adminB] = principals;
    const branding = await updateBranding(db, adminA, {
      name: 'North Clinic',
      legal_name: 'North Clinic sh.p.k.',
      address: '1 Health Street',
      city: 'Tirana',
      postal_code: '1001',
      country: 'AL',
      phone: '+355111',
      email: 'hello@north.example',
      website: 'https://north.example',
      registration_number: 'REG-1',
    });
    assert.equal(branding.name, 'North Clinic');
    const withLogo = await upsertLogo(db, adminA, {
      bytes: await png(),
      filename: '../evil.png',
    });
    assert.equal(withLogo.has_logo, true);
    await assert.rejects(
      () =>
        upsertLogo(db, adminA, {
          bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
          filename: 'x.svg',
        }),
      (error: unknown) => error instanceof BrandingError && error.status === 400,
    );
    const other = await getBranding(db, adminB);
    assert.equal(other.has_logo, false);
    assert.notEqual(other.name, 'North Clinic');
    await clearLogo(db, adminA);
    assert.equal((await getBranding(db, adminA)).has_logo, false);
    await createPatient(db, adminA, {
      data: { ...emptyPatient, first_name: 'Pat', last_name: 'One', sex: 'FEMALE' },
      acknowledgeDuplicates: true,
    });
  } finally {
    await db.close();
  }
});
