import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  createPatient,
  getPatient,
  updatePatient,
  listPatients,
  patientActivity,
} from '../features/patients/repository';
import { patientSchema, emptyPatient } from '../features/patients/validation';
import { PatientError } from '../features/patients/types';
import { ageOn } from '../features/patients/format';
import type { Principal } from '../lib/auth/permissions';
async function fixture() {
  const db = new PGlite();
  for (const name of ['001_foundation.sql', '002_patient_crm.sql'])
    await db.exec(
      await readFile(
        new URL(`../db/migrations/${name}`, import.meta.url),
        'utf8',
      ),
    );
  const principals: Principal[] = [];
  for (const slug of ['a', 'b']) {
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country) VALUES($1,$1,'CLINIC','AL') RETURNING id",
        [slug],
      )
    ).rows[0].id;
    const user = (
      await db.query<{ id: string }>(
        "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Test',$2,'unused','ORG_ADMIN') RETURNING id",
        [org, `${slug}@example.test`],
      )
    ).rows[0].id;
    principals.push({
      userId: user,
      organizationId: org,
      name: 'Test',
      organizationName: slug,
      role: 'ORG_ADMIN',
      sessionHash: 'test-session',
    });
  }
  return { db, a: principals[0], b: principals[1] };
}
const input = (patch = {}) => ({
  data: {
    ...emptyPatient,
    first_name: 'Synthetic',
    last_name: 'Patient',
    ...patch,
  },
});
const hasCode = (code: string) => (error: unknown) =>
  error instanceof PatientError && error.code === code;
void test('patient validation rejects malformed dates, unknown ownership fields and invalid contacts', () => {
  for (const patch of [
    { first_name: '' },
    { date_of_birth: '2025-02-29' },
    { date_of_birth: '2999-01-01' },
    { email: 'invalid' },
    { phone: 'letters' },
    { national_id: '---' },
    { notes: 'x'.repeat(4001) },
    { organization_id: 'injected' },
  ])
    assert.equal(patientSchema.safeParse(input(patch).data).success, false);
  assert.equal(
    patientSchema.safeParse(input({ date_of_birth: '2000-02-29' }).data)
      .success,
    true,
  );
  assert.equal(ageOn('2000-09-11', '2026-09-10'), 25);
  assert.equal(ageOn('2000-09-10', '2026-09-10'), 26);
  assert.equal(ageOn(''), null);
});
void test('create, retrieve, update and status changes retain identity and append value-free audit events', async () => {
  const { db, a } = await fixture();
  try {
    const patient = await createPatient(
      db,
      a,
      input({ national_id: 'DEV-100', date_of_birth: '1990-01-01' }),
    );
    assert.equal(patient.patient_number, 'PAT-000001');
    assert.equal(patient.created_by, a.userId);
    assert.equal((await getPatient(db, a, patient.id)).id, patient.id);
    const updated = await updatePatient(db, a, patient.id, {
      data: {
        ...input().data,
        first_name: 'Updated',
        national_id: 'DEV-100',
        date_of_birth: '1990-01-01',
        status: 'INACTIVE',
      },
      version: patient.version,
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.status, 'INACTIVE');
    assert.equal(updated.created_at, patient.created_at);
    assert.equal(updated.created_by, patient.created_by);
    assert.equal(updated.patient_number, patient.patient_number);
    const activity = await patientActivity(db, a, patient.id);
    assert.equal(activity.length, 3);
    assert.ok(
      activity.some((event) => event.action === 'PATIENT_STATUS_CHANGED'),
    );
    const metadata = JSON.stringify(activity.map((event) => event.metadata));
    assert.ok(!metadata.includes('DEV-100'));
    assert.ok(!metadata.includes('Updated'));
    assert.ok(metadata.includes('first_name'));
    await assert.rejects(
      updatePatient(db, a, patient.id, { ...input(), version: 1 }),
      hasCode('STALE_VERSION'),
    );
    await assert.rejects(
      db.query(
        'UPDATE patients SET organization_id=gen_random_uuid() WHERE id=$1',
        [patient.id],
      ),
      /immutable/,
    );
    await assert.rejects(db.exec('DELETE FROM audit_events'), /append-only/);
  } finally {
    await db.close();
  }
});
void test('tenant isolation prevents cross-organization retrieval, update, activity and duplicate leaks', async () => {
  const { db, a, b } = await fixture();
  try {
    const patient = await createPatient(
      db,
      a,
      input({
        national_id: 'SAME-ID',
        phone: '+355 123456',
        email: 'same@example.test',
      }),
    );
    await assert.rejects(getPatient(db, b, patient.id), hasCode('NOT_FOUND'));
    await assert.rejects(
      updatePatient(db, b, patient.id, { ...input(), version: 1 }),
      hasCode('NOT_FOUND'),
    );
    await assert.rejects(
      patientActivity(db, b, patient.id),
      hasCode('NOT_FOUND'),
    );
    assert.equal((await listPatients(db, b, { query: 'SAME-ID' })).total, 0);
    const own = await createPatient(
      db,
      b,
      input({
        national_id: 'SAME-ID',
        phone: '+355 123456',
        email: 'same@example.test',
      }),
    );
    assert.equal(own.patient_number, 'PAT-000001');
    assert.notEqual(own.id, patient.id);
    assert.equal((await getPatient(db, a, patient.id)).first_name, 'Synthetic');
    await assert.rejects(
      db.query('UPDATE patients SET updated_by=$1 WHERE id=$2', [
        b.userId,
        patient.id,
      ]),
      /foreign key/,
    );
  } finally {
    await db.close();
  }
});
void test('duplicate warnings require acknowledgment; exact normalized IDs remain unique', async () => {
  const { db, a } = await fixture();
  try {
    await createPatient(
      db,
      a,
      input({
        national_id: 'AA-123',
        phone: '+355 123456',
        email: 'same@example.test',
        date_of_birth: '1990-02-10',
      }),
    );
    await assert.rejects(
      createPatient(db, a, {
        ...input({ national_id: 'aa 123' }),
        acknowledgeDuplicates: true,
      }),
      hasCode('NATIONAL_ID_DUPLICATE'),
    );
    for (const patch of [
      { phone: '355123456' },
      { email: 'SAME@EXAMPLE.TEST' },
      { date_of_birth: '1990-02-10' },
    ])
      await assert.rejects(
        createPatient(db, a, input(patch)),
        hasCode('DUPLICATE_WARNING'),
      );
    const allowed = await createPatient(db, a, {
      ...input({ phone: '355123456' }),
      acknowledgeDuplicates: true,
    });
    assert.equal(allowed.patient_number, 'PAT-000002');
    await assert.rejects(
      updatePatient(db, a, allowed.id, {
        ...input({ national_id: 'AA123' }),
        version: 1,
        acknowledgeDuplicates: true,
      }),
      hasCode('NATIONAL_ID_DUPLICATE'),
    );
  } finally {
    await db.close();
  }
});
void test('server search, deterministic sorting and bounded pagination return only the current tenant', async () => {
  const { db, a, b } = await fixture();
  try {
    for (let i = 0; i < 7; i++)
      await createPatient(
        db,
        a,
        input({
          first_name: `Example ${i}`,
          last_name: `Family ${i}`,
          national_id: `DEV${i}`,
          phone: `3550000${i}`,
          email: `example${i}@example.test`,
        }),
      );
    await createPatient(db, b, input({ first_name: 'Hidden' }));
    for (const query of [
      'Example 3',
      'Family 3',
      'PAT-000004',
      'DEV3',
      '35500003',
      'example3@example.test',
    ]) {
      const found = await listPatients(db, a, { query });
      assert.equal(found.total, 1, query);
    }
    const page1 = await listPatients(db, a, {
      pageSize: 3,
      sort: 'patient_number',
    });
    const page2 = await listPatients(db, a, {
      pageSize: 3,
      page: 2,
      sort: 'patient_number',
    });
    assert.equal(page1.total, 7);
    assert.equal(page1.patients.length, 3);
    assert.equal(page2.patients[0].patient_number, 'PAT-000004');
    assert.ok(
      !page2.patients.some((p) =>
        page1.patients.some((other) => other.id === p.id),
      ),
    );
    assert.equal((await listPatients(db, a, { query: '%' })).total, 0);
    assert.equal(
      (await listPatients(db, a, { query: "' OR true --" })).total,
      0,
    );
    await assert.rejects(
      listPatients(db, a, { pageSize: 1000 }),
      hasCode('VALIDATION'),
    );
    await assert.rejects(
      listPatients(db, a, { sort: 'organization_id; DROP TABLE patients' }),
      hasCode('VALIDATION'),
    );
  } finally {
    await db.close();
  }
});
void test('roles enforce sensitive reads, create/edit and activity permissions server-side', async () => {
  const { db, a } = await fixture();
  try {
    const patient = await createPatient(db, a, input());
    const viewer = { ...a, role: 'VIEWER' as const };
    const doctor = { ...a, role: 'DOCTOR' as const };
    await assert.rejects(
      getPatient(db, viewer, patient.id),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(listPatients(db, viewer, {}), hasCode('FORBIDDEN'));
    assert.equal((await getPatient(db, doctor, patient.id)).id, patient.id);
    await assert.rejects(
      createPatient(db, doctor, input()),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      updatePatient(db, doctor, patient.id, { ...input(), version: 1 }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      patientActivity(db, doctor, patient.id),
      hasCode('FORBIDDEN'),
    );
    assert.ok(
      await createPatient(
        db,
        { ...a, role: 'RECEPTIONIST' },
        input({ first_name: 'Other' }),
      ),
    );
  } finally {
    await db.close();
  }
});
void test('audit failure rolls back patient changes and number allocation', async () => {
  const { db, a } = await fixture();
  try {
    await db.exec(
      "CREATE FUNCTION fail_patient_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit test failure'; END; $$; CREATE TRIGGER fail_patient_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_patient_audit();",
    );
    await assert.rejects(createPatient(db, a, input()), /audit test failure/);
    assert.equal((await db.query('SELECT * FROM patients')).rows.length, 0);
    assert.equal(
      (await db.query('SELECT * FROM patient_counters')).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
void test('development fixtures are idempotent and preserve staff edits', async () => {
  const { db, a, b } = await fixture();
  try {
    const { seedPatients } = await import('../scripts/seed-patients');
    await db.query('BEGIN');
    await seedPatients(db, a.organizationId, a.userId, 1);
    await seedPatients(db, b.organizationId, b.userId, 2);
    await db.query('COMMIT');
    const first = (await listPatients(db, a, {})).patients[0];
    const patient = await getPatient(db, a, first.id);
    await updatePatient(db, a, patient.id, {
      data: { ...input().data, first_name: 'Staff edited' },
      version: patient.version,
    });
    await db.query('BEGIN');
    await seedPatients(db, a.organizationId, a.userId, 1);
    await seedPatients(db, b.organizationId, b.userId, 2);
    await db.query('COMMIT');
    assert.equal((await listPatients(db, a, {})).total, 3);
    assert.equal((await listPatients(db, b, {})).total, 3);
    assert.equal(
      (await getPatient(db, a, patient.id)).first_name,
      'Staff edited',
    );
  } finally {
    await db.close();
  }
});
