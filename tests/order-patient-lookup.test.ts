import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPatient, listPatients } from '../features/patients/repository';
import {
  createCategory,
  createTest,
  createUnit,
} from '../features/catalogue/repository';
import { createOrder, getOrder } from '../features/orders/repository';
import { OrderError } from '../features/orders/types';
import { emptyPatient } from '../features/patients/validation';
import {
  labOrderSubmitBody,
  patientSearchBody,
  patientsFromSearchResponse,
} from '../features/orders/patient-lookup';
import type { Principal, Role } from '../lib/auth/permissions';
import type { PatientSummary } from '../features/patients/types';
async function fixture() {
  const db = new PGlite();
  for (const name of [
    '001_foundation.sql',
    '002_patient_crm.sql',
    '003_lab_catalogue.sql',
    '004_lab_orders_specimens.sql',
  ])
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
  const [a, b] = principals;
  const john = await createPatient(db, a, {
    data: {
      ...emptyPatient,
      first_name: 'John',
      last_name: 'Test',
      national_id: 'AA-100',
      phone: '+355 12345678',
      email: 'john-test@example.test',
    },
    acknowledgeDuplicates: true,
  });
  const ada = await createPatient(db, a, {
    data: { ...emptyPatient, first_name: 'Ada', last_name: 'Lovelace' },
    acknowledgeDuplicates: true,
  });
  const other = await createPatient(db, b, {
    data: { ...emptyPatient, first_name: 'Other', last_name: 'Clinic' },
    acknowledgeDuplicates: true,
  });
  const category = await createCategory(db, a, {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const unit = await createUnit(db, a, {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const glu = await createTest(db, a, {
    data: {
      code: 'GLU',
      name: 'Glucose',
      short_name: 'Glu',
      category_id: category.id,
      description: '',
      specimen_type: 'SERUM',
      result_type: 'NUMERIC',
      unit_id: unit.id,
      method: 'Hexokinase',
      display_order: 10,
      base_price: '8.00',
      is_active: true,
    },
  });
  return { db, a, b, john, ada, other, glu };
}
const asRole = (principal: Principal, role: Role): Principal => ({
  ...principal,
  role,
});
void test('order-form patient search stays organization-scoped for authorized roles', async () => {
  const { db, a, b, john, ada, other } = await fixture();
  try {
    const empty = await listPatients(db, a, patientSearchBody(''));
    assert.equal(empty.total, 2);
    assert.ok(empty.patients.some((row) => row.id === john.id));
    assert.ok(empty.patients.some((row) => row.id === ada.id));
    assert.ok(!empty.patients.some((row) => row.id === other.id));
    const receptionist = await listPatients(
      db,
      asRole(a, 'RECEPTIONIST'),
      patientSearchBody(''),
    );
    assert.equal(receptionist.total, 2);
    const hidden = await listPatients(db, b, patientSearchBody('John'));
    assert.equal(hidden.total, 0);
    await assert.rejects(
      listPatients(db, asRole(a, 'VIEWER'), patientSearchBody('John')),
    );
  } finally {
    await db.close();
  }
});
void test('order-form patient search matches name, number, identifier and ignores case and spaces', async () => {
  const { db, a, john } = await fixture();
  try {
    for (const query of [
      'John',
      'john',
      'Jo',
      'Test',
      'John Test',
      ' john  ',
      john.patient_number,
      'AA-100',
      'aa100',
    ]) {
      const found = await listPatients(db, a, patientSearchBody(query));
      assert.equal(found.total, 1, query);
      assert.equal(found.patients[0].id, john.id, query);
    }
    assert.equal(
      (await listPatients(db, a, patientSearchBody('Ada'))).total,
      1,
    );
    assert.equal(
      (await listPatients(db, a, patientSearchBody('zzz'))).total,
      0,
    );
  } finally {
    await db.close();
  }
});
void test('patient picker consumes { patients } and submits the selected tenant patient id', async () => {
  const { db, a, b, john, other, glu } = await fixture();
  try {
    const page = await listPatients(db, a, patientSearchBody('John'));
    const hits = patientsFromSearchResponse(page);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, john.id);
    assert.deepEqual(patientsFromSearchResponse(hits), []);
    assert.deepEqual(patientsFromSearchResponse({}), []);
    const selected = hits[0];
    const payload = labOrderSubmitBody(
      selected,
      {
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
      },
      [glu.id],
      false,
    );
    assert.equal(payload.data.patient_id, john.id);
    const created = await createOrder(db, a, payload);
    assert.equal(created.patient_id, john.id);
    assert.equal(
      (await getOrder(db, a, created.id)).patient_first_name,
      'John',
    );
    await assert.rejects(
      createOrder(
        db,
        a,
        labOrderSubmitBody(
          other,
          {
            priority: 'ROUTINE',
            ordering_physician_name: '',
            clinical_notes: '',
            fasting_status: 'UNKNOWN',
            external_reference: '',
          },
          [glu.id],
          false,
        ),
      ),
      (error: unknown) =>
        error instanceof OrderError && error.code === 'PATIENT_NOT_FOUND',
    );
    await assert.rejects(
      createOrder(
        db,
        a,
        labOrderSubmitBody(
          { id: '00000000-0000-4000-8000-000000000099' },
          {
            priority: 'ROUTINE',
            ordering_physician_name: '',
            clinical_notes: '',
            fasting_status: 'UNKNOWN',
            external_reference: '',
          },
          [],
          false,
        ),
      ),
      (error: unknown) =>
        error instanceof OrderError && error.code === 'PATIENT_NOT_FOUND',
    );
    const foreign = await listPatients(db, b, patientSearchBody('Other'));
    assert.equal(patientsFromSearchResponse(foreign)[0].id, other.id);
    assert.notEqual(patientsFromSearchResponse(foreign)[0].id, john.id);
  } finally {
    await db.close();
  }
});
void test('patientsFromSearchResponse rejects non-page payloads used by a stale client', () => {
  const sample: PatientSummary = {
    id: '10000000-0000-4000-8000-000000000019',
    patient_number: 'PAT-000005',
    first_name: 'John',
    last_name: 'Test',
    date_of_birth: '1990-01-01',
    phone: '',
    email: '',
    status: 'ACTIVE',
    updated_at: '2026-09-17T00:00:00.000Z',
  };
  assert.deepEqual(
    patientsFromSearchResponse({ patients: [sample], total: 1 }),
    [sample],
  );
  assert.deepEqual(patientsFromSearchResponse([sample]), []);
  assert.deepEqual(patientsFromSearchResponse({ data: [sample] }), []);
});
