import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPatient } from '../features/patients/repository';
import {
  createCategory,
  createRange,
  createTest,
  createUnit,
  updateTest,
} from '../features/catalogue/repository';
import {
  createOrder,
  createSpecimen,
  placeOrder,
  receiveSpecimen,
} from '../features/orders/repository';
import {
  amendResult,
  enterResult,
  validateResult,
  verifyResult,
} from '../features/results/repository';
import {
  downloadReportPdf,
  generateReport,
  getReport,
  getReportContext,
  listOrderReports,
  recordReportDelivery,
} from '../features/reports/repository';
import { ReportError } from '../features/reports/types';
import type { LabReportSnapshot } from '../features/reports/types';
import { emptyPatient } from '../features/patients/validation';
import type { Principal, Role } from '../lib/auth/permissions';
import type { LabOrder } from '../features/orders/types';
async function fixture() {
  const db = new PGlite();
  for (const name of [
    '001_foundation.sql',
    '002_patient_crm.sql',
    '003_lab_catalogue.sql',
    '004_lab_orders_specimens.sql',
    '005_lab_results.sql',
    '006_lab_reports.sql',
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
        "INSERT INTO organizations(name,slug,type,country,address,phone,email) VALUES($1,$1,'CLINIC','AL','1 Lab Street','+355000','lab@example.test') RETURNING id",
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
    data: {
      ...emptyPatient,
      first_name: 'John',
      last_name: 'Test',
      date_of_birth: '1990-01-01',
      sex: 'MALE',
    },
    acknowledgeDuplicates: true,
  });
  const patientB = await createPatient(db, b, {
    data: {
      ...emptyPatient,
      first_name: 'Other',
      last_name: 'Clinic',
      date_of_birth: '1990-01-01',
      sex: 'FEMALE',
    },
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
  const altA = await createTest(db, a, testInput(categoryA.id, unitA.id, 'ALT'));
  const gluB = await createTest(db, b, testInput(categoryB.id, unitB.id, 'GLU'));
  await createRange(db, a, gluA.id, rangeInput(unitA.id));
  await createRange(db, a, altA.id, rangeInput(unitA.id));
  await createRange(db, b, gluB.id, rangeInput(unitB.id));
  return { db, a, b, patientA, patientB, gluA, altA, gluB, unitA, categoryA };
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
const rangeInput = (unitId = '', patch: Record<string, unknown> = {}) => ({
  data: {
    sex: 'ANY',
    age_min: '18',
    age_max: '120',
    age_unit: 'YEARS',
    lower_bound: '70',
    upper_bound: '99',
    lower_operator: 'GE',
    upper_operator: 'LE',
    text_range: '',
    unit_id: unitId,
    method: 'Hexokinase',
    critical_low: '40',
    critical_high: '450',
    valid_from: '',
    ...patch,
  },
});
const hasCode = (code: string) => (error: unknown) =>
  error instanceof ReportError && error.code === code;
async function receivedOrder(
  db: PGlite,
  principal: Principal,
  patientId: string,
  testIds: string[],
) {
  const created = await createOrder(db, principal, {
    data: {
      patient_id: patientId,
      priority: 'ROUTINE',
      ordering_physician_name: 'Dr Example',
      clinical_notes: '',
      fasting_status: 'FASTING',
      external_reference: '',
      test_ids: testIds,
    },
  });
  const placed = await placeOrder(db, principal, created.id, {
    version: created.version,
  });
  const collected = await createSpecimen(db, principal, placed.id, {
    specimen_type: 'SERUM',
    order_test_ids: placed.tests.map((test) => test.id),
    collection_notes: '',
    version: placed.version,
  });
  return receiveSpecimen(db, principal, collected.specimens[0].id, {
    version: collected.specimens[0].version,
  });
}
async function verifyValue(
  db: PGlite,
  principal: Principal,
  order: LabOrder,
  testId: string,
  numeric: string,
) {
  const entered = await enterResult(db, principal, order.id, testId, {
    numeric_value: numeric,
    version: order.version,
  });
  const current = entered.results.find(
    (row) => row.order_test_id === testId && row.is_current,
  )!;
  const validated = await validateResult(db, principal, current.id, {
    version: Number(current.version),
  });
  const ready = validated.results.find(
    (row) => row.order_test_id === testId && row.is_current,
  )!;
  return verifyResult(db, principal, ready.id, {
    version: Number(ready.version),
  });
}
async function loadSnapshot(db: PGlite, id: string) {
  const row = (
    await db.query<{ snapshot: LabReportSnapshot | string }>(
      'SELECT snapshot FROM lab_reports WHERE id=$1',
      [id],
    )
  ).rows[0];
  return typeof row.snapshot === 'string'
    ? (JSON.parse(row.snapshot) as LabReportSnapshot)
    : row.snapshot;
}
void test('order completion follows current clinically verified results', async () => {
  const { db, a, patientA, gluA, altA } = await fixture();
  try {
    const single = await receivedOrder(db, a, patientA.id, [gluA.id]);
    const verified = await verifyValue(db, a, single, single.tests[0].id, '85');
    assert.equal(verified.status, 'COMPLETED');
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_id=$1 AND action='LAB_ORDER_COMPLETED'",
        [verified.id],
      )
    ).rows;
    assert.equal(events.length, 1);
    const multi = await receivedOrder(db, a, patientA.id, [gluA.id, altA.id]);
    const first = await verifyValue(db, a, multi, multi.tests[0].id, '85');
    assert.equal(first.status, 'IN_PROCESS');
    await assert.rejects(
      generateReport(db, a, first.id, {}),
      hasCode('ORDER_NOT_COMPLETE'),
    );
    const second = await verifyValue(db, a, first, first.tests[1].id, '88');
    assert.equal(second.status, 'COMPLETED');
    const missing = await receivedOrder(db, a, patientA.id, [gluA.id, altA.id]);
    const oneResult = await verifyValue(db, a, missing, missing.tests[0].id, '85');
    assert.equal(oneResult.status, 'IN_PROCESS');
    const cancelled = await receivedOrder(db, a, patientA.id, [gluA.id, altA.id]);
    await db.query(
      "UPDATE lab_order_tests SET status='CANCELLED' WHERE organization_id=$1 AND id=$2",
      [a.organizationId, cancelled.tests[1].id],
    );
    const afterCancel = await verifyValue(
      db,
      a,
      cancelled,
      cancelled.tests[0].id,
      '85',
    );
    assert.equal(afterCancel.status, 'COMPLETED');
    const context = await getReportContext(db, a, afterCancel.id);
    assert.equal(context.complete, true);
    assert.equal(context.eligible, true);
  } finally {
    await db.close();
  }
});
void test('amendments reopen completed orders and re-verification completes them', async () => {
  const { db, a, patientA, gluA } = await fixture();
  try {
    const received = await receivedOrder(db, a, patientA.id, [gluA.id]);
    const verified = await verifyValue(db, a, received, received.tests[0].id, '85');
    assert.equal(verified.status, 'COMPLETED');
    const current = verified.results.find((row) => row.is_current)!;
    const amended = await amendResult(db, a, current.id, {
      numeric_value: '88',
      reason: 'Transcription correction',
      version: Number(current.version),
    });
    assert.equal(amended.status, 'IN_PROCESS');
    const reopened = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_id=$1 AND action='LAB_ORDER_REOPENED'",
        [amended.id],
      )
    ).rows;
    assert.equal(reopened.length, 1);
    await assert.rejects(
      generateReport(db, a, amended.id, {}),
      hasCode('ORDER_NOT_COMPLETE'),
    );
    const latest = amended.results.find((row) => row.is_current)!;
    const recompleted = await verifyValue(
      db,
      a,
      amended,
      latest.order_test_id,
      latest.numeric_value,
    );
    assert.equal(recompleted.status, 'COMPLETED');
  } finally {
    await db.close();
  }
});
void test('issued reports freeze snapshots, version and remain tenant scoped', async () => {
  const { db, a, b, patientA, patientB, gluA, gluB, unitA, categoryA } =
    await fixture();
  try {
    const received = await receivedOrder(db, a, patientA.id, [gluA.id]);
    const verified = await verifyValue(db, a, received, received.tests[0].id, '85');
    const asRole = (role: Role): Principal => ({ ...a, role });
    await assert.rejects(
      generateReport(db, asRole('DOCTOR'), verified.id, {}),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      generateReport(db, b, verified.id, {}),
      (error: unknown) => error instanceof ReportError && error.status === 404,
    );
    const issued = await generateReport(db, a, verified.id, {});
    assert.equal(issued.status, 'COMPLETED');
    assert.equal(issued.reports.length, 1);
    assert.equal(issued.reports[0].report_version, 1);
    assert.equal(
      issued.reports[0].report_number,
      `${issued.order_number}-R1`,
    );
    await assert.rejects(
      generateReport(db, a, issued.id, {}),
      hasCode('REPORT_ALREADY_CURRENT'),
    );
    const snapshot = await loadSnapshot(db, issued.reports[0].id);
    assert.equal(snapshot.patient.first_name, 'John');
    assert.equal(snapshot.organization.name, 'a');
    assert.equal(snapshot.results[0].result_display.includes('85'), true);
    assert.equal(snapshot.results[0].unit_symbol, 'mg/dL');
    await db.query("UPDATE patients SET first_name='Changed' WHERE id=$1", [
      patientA.id,
    ]);
    await db.query(
      "UPDATE organizations SET name='Renamed',address='Other street' WHERE id=$1",
      [a.organizationId],
    );
    await updateTest(db, a, gluA.id, {
      data: {
        ...testInput(categoryA.id, unitA.id, 'GLU').data,
        method: 'Changed later',
        is_active: true,
      },
      version: Number(gluA.version),
    });
    const current = issued.results.find((row) => row.is_current)!;
    const amended = await amendResult(db, a, current.id, {
      numeric_value: '92',
      reason: 'Clinician requested repeat',
      version: Number(current.version),
    });
    const frozen = await loadSnapshot(db, issued.reports[0].id);
    assert.equal(frozen.patient.first_name, 'John');
    assert.equal(frozen.organization.name, 'a');
    assert.equal(frozen.organization.address, '1 Lab Street');
    assert.equal(frozen.results[0].result_display.includes('85'), true);
    assert.equal(frozen.results[0].method, 'Hexokinase');
    await assert.rejects(
      db.query("UPDATE lab_reports SET snapshot='{}'::jsonb WHERE id=$1", [
        issued.reports[0].id,
      ]),
      (error: unknown) => String(error).includes('immutable'),
    );
    await assert.rejects(
      db.query('DELETE FROM lab_reports WHERE id=$1', [issued.reports[0].id]),
      (error: unknown) => String(error).includes('not deleted'),
    );
    const latest = amended.results.find((row) => row.is_current)!;
    const recompleted = await verifyValue(
      db,
      a,
      amended,
      latest.order_test_id,
      latest.numeric_value,
    );
    const v2 = await generateReport(db, a, recompleted.id, {});
    assert.equal(v2.reports.length, 2);
    const currentReport = v2.reports.find((row) => row.is_current)!;
    const previous = v2.reports.find((row) => !row.is_current)!;
    assert.equal(currentReport.report_version, 2);
    assert.equal(previous.report_version, 1);
    assert.equal(previous.status, 'SUPERSEDED');
    assert.equal(currentReport.supersedes_id, previous.id);
    const oldSnapshot = await loadSnapshot(db, previous.id);
    const newSnapshot = await loadSnapshot(db, currentReport.id);
    assert.equal(oldSnapshot.results[0].numeric_value, '85');
    assert.equal(newSnapshot.results[0].numeric_value, '92');
    const history = await listOrderReports(db, a, v2.id);
    assert.equal(history.length, 2);
    await assert.rejects(
      getReport(db, b, currentReport.id),
      (error: unknown) => error instanceof ReportError && error.status === 404,
    );
    const pdf = await downloadReportPdf(db, a, previous.id);
    assert.equal(pdf.pdf.subarray(0, 4).toString(), '%PDF');
    assert.equal(pdf.report.id, previous.id);
    assert.equal(pdf.report.report_version, 1);
    await assert.rejects(
      downloadReportPdf(db, asRole('LAB_TECHNICIAN'), currentReport.id),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      downloadReportPdf(db, b, currentReport.id),
      (error: unknown) => error instanceof ReportError && error.status === 404,
    );
    const delivery = await recordReportDelivery(db, a, currentReport.id, {
      method: 'PRINT',
      recipient_descriptor: 'Ward 2',
    });
    assert.equal(delivery.method, 'PRINT');
    await assert.rejects(
      recordReportDelivery(db, asRole('DOCTOR'), currentReport.id, {
        method: 'MANUAL',
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      recordReportDelivery(db, b, currentReport.id, { method: 'MANUAL' }),
      (error: unknown) => error instanceof ReportError && error.status === 404,
    );
    const audit = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_type='LAB_REPORT' ORDER BY occurred_at,id",
      )
    ).rows.map((row) => row.action);
    for (const action of [
      'LAB_REPORT_GENERATED',
      'LAB_REPORT_SUPERSEDED',
      'LAB_REPORT_DOWNLOADED',
      'LAB_REPORT_DELIVERED',
    ])
      assert.ok(audit.includes(action), action);
    const orderB = await receivedOrder(db, b, patientB.id, [gluB.id]);
    const verifiedB = await verifyValue(db, b, orderB, orderB.tests[0].id, '80');
    const reportB = await generateReport(db, b, verifiedB.id, {});
    await assert.rejects(
      getReport(db, a, reportB.reports[0].id),
      (error: unknown) => error instanceof ReportError && error.status === 404,
    );
  } finally {
    await db.close();
  }
});
