import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPatient } from '../features/patients/repository';
import {
  createCategory,
  createTest,
  createUnit,
  updateTest,
} from '../features/catalogue/repository';
import {
  addOrderTests,
  cancelOrder,
  createOrder,
  createSpecimen,
  getOrder,
  listOrders,
  placeOrder,
  receiveSpecimen,
  rejectSpecimen,
  removeOrderTest,
  updateOrder,
} from '../features/orders/repository';
import { OrderError } from '../features/orders/types';
import { emptyPatient } from '../features/patients/validation';
import type { Principal, Role } from '../lib/auth/permissions';
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
  const patientA = await createPatient(db, a, {
    data: { ...emptyPatient, first_name: 'John', last_name: 'Test' },
    acknowledgeDuplicates: true,
  });
  const patientB = await createPatient(db, b, {
    data: { ...emptyPatient, first_name: 'Other', last_name: 'Clinic' },
    acknowledgeDuplicates: true,
  });
  const categoryA = await createCategory(db, a, {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const categoryB = await createCategory(db, b, {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const unitA = await createUnit(db, a, {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const unitB = await createUnit(db, b, {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const gluA = await createTest(db, a, testInput(categoryA.id, unitA.id, 'GLU'));
  const altA = await createTest(
    db,
    a,
    testInput(categoryA.id, unitA.id, 'ALT', { name: 'Alanine aminotransferase' }),
  );
  const cbcA = await createTest(
    db,
    a,
    testInput(categoryA.id, unitA.id, 'CBC', {
      name: 'Complete blood count',
      specimen_type: 'WHOLE_BLOOD',
    }),
  );
  const gluB = await createTest(db, b, testInput(categoryB.id, unitB.id, 'GLU'));
  return { db, a, b, patientA, patientB, gluA, altA, cbcA, gluB };
}
const testInput = (
  categoryId: string,
  unitId: string,
  code: string,
  patch: Record<string, unknown> = {},
) => ({
  data: {
    code,
    name: code,
    short_name: code,
    category_id: categoryId,
    description: '',
    specimen_type: 'SERUM',
    result_type: 'NUMERIC',
    unit_id: unitId,
    method: 'Hexokinase',
    display_order: 10,
    base_price: '8.00',
    is_active: true,
    ...patch,
  },
});
const hasCode = (code: string) => (error: unknown) =>
  error instanceof OrderError && error.code === code;
void test('orders require a tenant patient, snapshot catalogue data and reject inactive or duplicate tests', async () => {
  const { db, a, b, patientA, patientB, gluA, altA, cbcA, gluB } =
    await fixture();
  await assert.rejects(
    createOrder(db, a, {
      data: {
        patient_id: patientB.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [gluA.id],
      },
    }),
    hasCode('PATIENT_NOT_FOUND'),
  );
  const missing = '00000000-0000-4000-8000-000000000099';
  await assert.rejects(
    createOrder(db, a, {
      data: {
        patient_id: missing,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [],
      },
    }),
    hasCode('PATIENT_NOT_FOUND'),
  );
  const draft = await createOrder(db, a, {
    data: {
      patient_id: patientA.id,
      priority: 'URGENT',
      ordering_physician_name: 'Dr Example',
      clinical_notes: 'Fasting',
      fasting_status: 'FASTING',
      external_reference: 'EXT-1',
      test_ids: [gluA.id, altA.id],
    },
  });
  assert.match(draft.order_number, /^LAB-\d{4}-\d{6}$/);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.tests.length, 2);
  await assert.rejects(
    addOrderTests(db, a, draft.id, {
      test_ids: [gluA.id],
      version: draft.version,
    }),
    hasCode('DUPLICATE_ORDER_TEST'),
  );
  await updateTest(db, a, gluA.id, {
    data: { ...testInput(gluA.category_id, gluA.unit_id, 'GLU').data, name: 'Changed glucose', is_active: false },
    version: gluA.version,
  });
  const latestDraft = await getOrder(db, a, draft.id);
  assert.equal(
    latestDraft.tests.find((row) => row.lab_test_id === gluA.id)?.name_snapshot,
    'GLU',
  );
  await assert.rejects(
    addOrderTests(db, a, draft.id, {
      test_ids: [gluA.id],
      version: latestDraft.version,
    }),
    hasCode('TEST_INACTIVE'),
  );
  await addOrderTests(db, a, draft.id, {
    test_ids: [cbcA.id],
    version: latestDraft.version,
  });
  const placed = await placeOrder(db, a, draft.id, {
    version: (await getOrder(db, a, draft.id)).version,
  });
  assert.equal(placed.status, 'ORDERED');
  assert.ok(placed.ordered_at);
  await assert.rejects(
    addOrderTests(db, a, placed.id, {
      test_ids: [cbcA.id],
      version: placed.version,
    }),
    hasCode('INVALID_ORDER_STATUS'),
  );
  await assert.rejects(
    removeOrderTest(db, a, placed.id, placed.tests[0].id, {
      version: placed.version,
    }),
    hasCode('INVALID_ORDER_STATUS'),
  );
  await assert.rejects(
    updateOrder(db, a, placed.id, {
      data: {
        patient_id: patientA.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
      },
      version: placed.version,
    }),
    hasCode('INVALID_ORDER_STATUS'),
  );
  await assert.rejects(getOrder(db, b, placed.id), hasCode('ORDER_NOT_FOUND'));
  const foreign = await listOrders(db, b, { query: placed.order_number });
  assert.equal(foreign.total, 0);
  await assert.rejects(
    createOrder(db, a, {
      data: {
        patient_id: patientA.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [gluB.id],
      },
    }),
    hasCode('VALIDATION'),
  );
});
void test('specimen coverage, compatibility, rejection replacement and derived order status', async () => {
  const { db, a, b, patientA, gluA, altA, cbcA } = await fixture();
  const order = await createOrder(db, a, {
    data: {
      patient_id: patientA.id,
      priority: 'ROUTINE',
      ordering_physician_name: '',
      clinical_notes: '',
      fasting_status: 'UNKNOWN',
      external_reference: '',
      test_ids: [gluA.id, altA.id, cbcA.id],
    },
    place: true,
  });
  assert.equal(order.status, 'ORDERED');
  const glu = order.tests.find((row) => row.code_snapshot === 'GLU')!;
  const alt = order.tests.find((row) => row.code_snapshot === 'ALT')!;
  const cbc = order.tests.find((row) => row.code_snapshot === 'CBC')!;
  await assert.rejects(
    createSpecimen(db, a, order.id, {
      specimen_type: 'SERUM',
      order_test_ids: [cbc.id],
      collection_notes: '',
      version: order.version,
    }),
    hasCode('SPECIMEN_TEST_MISMATCH'),
  );
  const afterSerum = await createSpecimen(db, a, order.id, {
    specimen_type: 'SERUM',
    order_test_ids: [glu.id, alt.id],
    collection_notes: '',
    version: order.version,
  });
  assert.equal(afterSerum.status, 'PARTIALLY_COLLECTED');
  assert.match(afterSerum.specimens[0].accession_number, /^ACC-\d{4}-\d{6}$/);
  const afterBlood = await createSpecimen(db, a, afterSerum.id, {
    specimen_type: 'WHOLE_BLOOD',
    order_test_ids: [cbc.id],
    collection_notes: '',
    version: afterSerum.version,
  });
  assert.equal(afterBlood.status, 'COLLECTED');
  assert.equal(afterBlood.specimens.length, 2);
  const serum = afterBlood.specimens.find((row) => row.specimen_type === 'SERUM')!;
  const blood = afterBlood.specimens.find(
    (row) => row.specimen_type === 'WHOLE_BLOOD',
  )!;
  await assert.rejects(
    receiveSpecimen(db, b, serum.id, { version: serum.version }),
    hasCode('SPECIMEN_NOT_FOUND'),
  );
  await assert.rejects(
    rejectSpecimen(db, a, serum.id, { version: serum.version, reason: '' }),
    hasCode('SPECIMEN_REJECTION_REASON_REQUIRED'),
  );
  const receivedSerum = await receiveSpecimen(db, a, serum.id, {
    version: serum.version,
  });
  assert.equal(receivedSerum.status, 'COLLECTED');
  const receivedAll = await receiveSpecimen(
    db,
    a,
    receivedSerum.specimens.find((row) => row.id === blood.id)!.id,
    {
      version: receivedSerum.specimens.find((row) => row.id === blood.id)!
        .version,
    },
  );
  assert.equal(receivedAll.status, 'RECEIVED');
  const rejected = await rejectSpecimen(
    db,
    a,
    receivedAll.specimens.find((row) => row.specimen_type === 'WHOLE_BLOOD')!.id,
    {
      version: receivedAll.specimens.find(
        (row) => row.specimen_type === 'WHOLE_BLOOD',
      )!.version,
      reason: 'clotted',
    },
  );
  assert.equal(
    rejected.specimens.find((row) => row.specimen_type === 'WHOLE_BLOOD')
      ?.status,
    'REJECTED',
  );
  assert.equal(rejected.status, 'PARTIALLY_COLLECTED');
  const replacement = await createSpecimen(db, a, rejected.id, {
    specimen_type: 'WHOLE_BLOOD',
    order_test_ids: [cbc.id],
    collection_notes: 'Redraw',
    version: rejected.version,
  });
  assert.equal(replacement.specimens.length, 3);
  assert.equal(
    replacement.specimens.filter((row) => row.specimen_type === 'WHOLE_BLOOD')
      .length,
    2,
  );
  await assert.rejects(db.exec('DELETE FROM lab_orders'), /not deleted/);
  await assert.rejects(db.exec('DELETE FROM lab_specimens'), /not deleted/);
});
void test('order transitions, cancellation policy and role grants', async () => {
  const { db, a, patientA, gluA } = await fixture();
  const draft = await createOrder(db, a, {
    data: {
      patient_id: patientA.id,
      priority: 'ROUTINE',
      ordering_physician_name: '',
      clinical_notes: '',
      fasting_status: 'UNKNOWN',
      external_reference: '',
      test_ids: [gluA.id],
    },
  });
  await assert.rejects(
    cancelOrder(db, a, draft.id, { version: draft.version, reason: '' }),
    hasCode('ORDER_CANCELLATION_REASON_REQUIRED'),
  );
  const cancelled = await cancelOrder(db, a, draft.id, {
    version: draft.version,
    reason: 'Patient declined',
  });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.tests[0].status, 'CANCELLED');
  await assert.rejects(
    placeOrder(db, a, cancelled.id, { version: cancelled.version }),
    hasCode('INVALID_ORDER_TRANSITION'),
  );
  const placed = await createOrder(db, a, {
    data: {
      patient_id: patientA.id,
      priority: 'ROUTINE',
      ordering_physician_name: '',
      clinical_notes: '',
      fasting_status: 'UNKNOWN',
      external_reference: '',
      test_ids: [gluA.id],
    },
    place: true,
  });
  const collected = await createSpecimen(db, a, placed.id, {
    specimen_type: 'SERUM',
    order_test_ids: [placed.tests[0].id],
    collection_notes: '',
    version: placed.version,
  });
  await assert.rejects(
    cancelOrder(db, a, collected.id, {
      version: collected.version,
      reason: 'too late',
    }),
    hasCode('INVALID_ORDER_TRANSITION'),
  );
  const asRole = (role: Role): Principal => ({ ...a, role });
  await assert.rejects(
    createOrder(db, asRole('VIEWER'), {
      data: {
        patient_id: patientA.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [gluA.id],
      },
    }),
    hasCode('FORBIDDEN'),
  );
  await assert.rejects(
    createOrder(db, asRole('DOCTOR'), {
      data: {
        patient_id: patientA.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [gluA.id],
      },
    }),
    hasCode('FORBIDDEN'),
  );
  await assert.rejects(
    getOrder(db, asRole('DOCTOR'), placed.id),
    hasCode('FORBIDDEN'),
  );
  await assert.rejects(
    createSpecimen(db, asRole('RECEPTIONIST'), placed.id, {
      specimen_type: 'SERUM',
      order_test_ids: [placed.tests[0].id],
      collection_notes: '',
      version: collected.version,
    }),
    hasCode('FORBIDDEN'),
  );
  const receptionistOrder = await createOrder(db, asRole('RECEPTIONIST'), {
    data: {
      patient_id: patientA.id,
      priority: 'ROUTINE',
      ordering_physician_name: '',
      clinical_notes: '',
      fasting_status: 'UNKNOWN',
      external_reference: '',
      test_ids: [gluA.id],
    },
    place: true,
  });
  assert.equal(receptionistOrder.status, 'ORDERED');
  await assert.rejects(
    cancelOrder(db, asRole('RECEPTIONIST'), receptionistOrder.id, {
      version: receptionistOrder.version,
      reason: 'changed mind',
    }),
    hasCode('FORBIDDEN'),
  );
  await assert.rejects(
    createOrder(db, asRole('LAB_TECHNICIAN'), {
      data: {
        patient_id: patientA.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
        test_ids: [gluA.id],
      },
    }),
    hasCode('FORBIDDEN'),
  );
  const techCollected = await createSpecimen(
    db,
    asRole('LAB_TECHNICIAN'),
    receptionistOrder.id,
    {
      specimen_type: 'SERUM',
      order_test_ids: [receptionistOrder.tests[0].id],
      collection_notes: '',
      version: receptionistOrder.version,
    },
  );
  assert.equal(techCollected.status, 'COLLECTED');
  const biochemistReceived = await receiveSpecimen(
    db,
    asRole('BIOCHEMIST'),
    techCollected.specimens[0].id,
    { version: techCollected.specimens[0].version },
  );
  assert.equal(biochemistReceived.status, 'RECEIVED');
  const events = (
    await db.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE entity_type IN ('LAB_ORDER','LAB_SPECIMEN') ORDER BY occurred_at,id",
    )
  ).rows.map((row) => row.action);
  assert.ok(events.includes('LAB_ORDER_CREATED'));
  assert.ok(events.includes('LAB_ORDER_PLACED'));
  assert.ok(events.includes('SPECIMEN_COLLECTED'));
  assert.ok(events.includes('SPECIMEN_RECEIVED'));
});
const orderInput = (patientId: string, testIds: string[]) => ({
  data: {
    patient_id: patientId,
    priority: 'ROUTINE' as const,
    ordering_physician_name: '',
    clinical_notes: '',
    fasting_status: 'UNKNOWN' as const,
    external_reference: '',
    test_ids: testIds,
  },
});
void test('draft removal, OTHER compatibility, unique accessions and cross-order links', async () => {
  const { db, a, b, patientA, patientB, gluA, altA, cbcA, gluB } =
    await fixture();
  const draft = await createOrder(db, a, orderInput(patientA.id, [gluA.id, altA.id]));
  const removed = await removeOrderTest(db, a, draft.id, draft.tests[0].id, {
    version: draft.version,
  });
  assert.equal(removed.tests.length, 1);
  await assert.rejects(
    createOrder(db, a, { ...orderInput(patientA.id, []), place: true }),
    hasCode('VALIDATION'),
  );
  const otherTest = await createTest(
    db,
    a,
    testInput(gluA.category_id, gluA.unit_id, 'MISC', {
      name: 'Miscellaneous',
      specimen_type: 'OTHER',
    }),
  );
  const otherOrder = await createOrder(db, a, {
    ...orderInput(patientA.id, [otherTest.id]),
    place: true,
  });
  const otherCollected = await createSpecimen(db, a, otherOrder.id, {
    specimen_type: 'URINE',
    order_test_ids: [otherOrder.tests[0].id],
    collection_notes: '',
    version: otherOrder.version,
  });
  assert.equal(otherCollected.status, 'COLLECTED');
  const first = await createOrder(db, a, {
    ...orderInput(patientA.id, [gluA.id, altA.id, cbcA.id]),
    place: true,
  });
  const second = await createOrder(db, a, {
    ...orderInput(patientA.id, [gluA.id]),
    place: true,
  });
  assert.notEqual(first.order_number, second.order_number);
  await assert.rejects(
    createSpecimen(db, a, first.id, {
      specimen_type: 'SERUM',
      order_test_ids: [second.tests[0].id],
      collection_notes: '',
      version: first.version,
    }),
    hasCode('VALIDATION'),
  );
  const orgBOrder = await createOrder(db, b, {
    ...orderInput(patientB.id, [gluB.id]),
    place: true,
  });
  await assert.rejects(
    createSpecimen(db, b, orgBOrder.id, {
      specimen_type: 'SERUM',
      order_test_ids: [first.tests[0].id],
      collection_notes: '',
      version: orgBOrder.version,
    }),
    hasCode('VALIDATION'),
  );
  await assert.rejects(
    updateOrder(db, b, first.id, {
      data: {
        patient_id: patientB.id,
        priority: 'URGENT',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
      },
      version: first.version,
    }),
    hasCode('ORDER_NOT_FOUND'),
  );
  const partial = await createSpecimen(db, a, first.id, {
    specimen_type: 'SERUM',
    order_test_ids: [
      first.tests.find((row) => row.code_snapshot === 'GLU')!.id,
      first.tests.find((row) => row.code_snapshot === 'ALT')!.id,
    ],
    collection_notes: '',
    version: first.version,
  });
  const complete = await createSpecimen(db, a, partial.id, {
    specimen_type: 'WHOLE_BLOOD',
    order_test_ids: [first.tests.find((row) => row.code_snapshot === 'CBC')!.id],
    collection_notes: '',
    version: partial.version,
  });
  const accessions = complete.specimens.map((row) => row.accession_number);
  assert.equal(new Set(accessions).size, accessions.length);
  await assert.rejects(
    db.query(
      `INSERT INTO lab_specimens(
 organization_id,order_id,accession_number,specimen_type,status,collected_at,collected_by,
 created_by,updated_by)
 VALUES($1,$2,$3,'SERUM','COLLECTED',now(),$4,$4,$4)`,
      [
        a.organizationId,
        complete.id,
        complete.specimens[0].accession_number,
        a.userId,
      ],
    ),
    /duplicate|unique/i,
  );
  await assert.rejects(
    db.query(
      `INSERT INTO lab_specimen_tests(
 organization_id,order_id,specimen_id,order_test_id,created_by)
 VALUES($1,$2,$3,$4,$5)`,
      [
        a.organizationId,
        complete.id,
        complete.specimens[0].id,
        orgBOrder.tests[0].id,
        a.userId,
      ],
    ),
    /foreign key|violates/i,
  );
  await assert.rejects(
    rejectSpecimen(db, b, complete.specimens[0].id, {
      version: complete.specimens[0].version,
      reason: 'hemolysed',
    }),
    hasCode('SPECIMEN_NOT_FOUND'),
  );
  const asRole = (role: Role): Principal => ({ ...a, role });
  await assert.rejects(
    getOrder(db, asRole('VIEWER'), complete.id),
    hasCode('FORBIDDEN'),
  );
  const techRead = await getOrder(db, asRole('LAB_TECHNICIAN'), complete.id);
  assert.equal(techRead.id, complete.id);
  const biochemistCollectOrder = await createOrder(db, a, {
    ...orderInput(patientA.id, [gluA.id]),
    place: true,
  });
  const biochemistCollected = await createSpecimen(
    db,
    asRole('BIOCHEMIST'),
    biochemistCollectOrder.id,
    {
      specimen_type: 'SERUM',
      order_test_ids: [biochemistCollectOrder.tests[0].id],
      collection_notes: '',
      version: biochemistCollectOrder.version,
    },
  );
  assert.equal(biochemistCollected.status, 'COLLECTED');
  await assert.rejects(
    placeOrder(db, asRole('LAB_TECHNICIAN'), removed.id, {
      version: removed.version,
    }),
    hasCode('FORBIDDEN'),
  );
  const cancelled = await cancelOrder(db, asRole('ORG_ADMIN'), second.id, {
    version: second.version,
    reason: 'Duplicate request',
  });
  assert.equal(cancelled.status, 'CANCELLED');
  const preserved = (
    await db.query<{ status: string; order_number: string }>(
      'SELECT status,order_number FROM lab_orders WHERE organization_id=$1 AND id=$2',
      [a.organizationId, cancelled.id],
    )
  ).rows[0];
  assert.equal(preserved.status, 'CANCELLED');
  assert.equal(preserved.order_number, second.order_number);
  await assert.rejects(
    updateOrder(db, a, complete.id, {
      data: {
        patient_id: patientA.id,
        priority: 'ROUTINE',
        ordering_physician_name: '',
        clinical_notes: '',
        fasting_status: 'UNKNOWN',
        external_reference: '',
      },
      version: complete.version,
    }),
    hasCode('INVALID_ORDER_STATUS'),
  );
});
