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
  listReportWork,
  recordReportDelivery,
} from '../features/reports/repository';
import { clinicalReportFromSnapshot } from '../features/reports/clinical';
import { renderReportPdf } from '../features/reports/pdf';
import { ReportError } from '../features/reports/types';
import type { LabReportSnapshot } from '../features/reports/types';
import { emptyPatient } from '../features/patients/validation';
import type { Principal, Role } from '../lib/auth/permissions';
import type { QueryRunner } from '../lib/db/query';
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
const liveClinicalTables =
  /\b(patients|lab_orders|lab_order_tests|lab_tests|lab_reference_ranges|lab_specimens|lab_specimen_tests|lab_results|lab_units|lab_test_categories)\b/i;
function withoutLiveClinical(db: PGlite): QueryRunner {
  return {
    query(sql, values) {
      if (liveClinicalTables.test(sql))
        throw new Error(`Live clinical table read is not allowed: ${sql}`);
      return db.query(sql, values);
    },
  };
}
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
    assert.equal(snapshot.results[0].flag_display, 'Normal');
    assert.equal(snapshot.issuance?.report_number, issued.reports[0].report_number);
    assert.equal(snapshot.issuance?.report_version, 1);
    assert.equal(snapshot.issuance?.issued_by_name, 'Test');
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
    const clinical = clinicalReportFromSnapshot(frozen);
    assert.equal(clinical.patient.first_name, 'John');
    assert.equal(clinical.organization.name, 'a');
    assert.equal(clinical.results[0].result_display.includes('85'), true);
    assert.equal(clinical.results[0].method, 'Hexokinase');
    assert.equal(clinical.results[0].flag_display, 'Normal');
    assert.equal(clinical.issuance.report_number, issued.reports[0].report_number);
    const listed = await listReportWork(db, a, { query: 'John' });
    assert.equal(
      listed.reports.some((row) => row.id === issued.reports[0].id),
      true,
    );
    assert.equal(listed.reports[0].patient_first_name, 'John');
    const renamedSearch = await listReportWork(db, a, { query: 'Changed' });
    assert.equal(renamedSearch.total, 0);
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
    const v1Text = pdfText(pdf.pdf);
    assert.ok(v1Text.includes('John'));
    assert.ok(v1Text.includes('85'));
    assert.ok(v1Text.includes('Hexokinase'));
    assert.equal(v1Text.includes('Changed'), false);
    assert.equal(v1Text.includes('Renamed'), false);
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
void test('issued clinical representation is reproduced only from snapshot', async () => {
  const { db, a, patientA, gluA, unitA, categoryA } = await fixture();
  try {
    const received = await receivedOrder(db, a, patientA.id, [gluA.id]);
    const verified = await verifyValue(db, a, received, received.tests[0].id, '85');
    const issued = await generateReport(db, a, verified.id, {});
    const reportId = issued.reports[0].id;
    const stored = await loadSnapshot(db, reportId);
    await db.query("UPDATE patients SET first_name='Changed',last_name='Other' WHERE id=$1", [
      patientA.id,
    ]);
    await db.query(
      "UPDATE organizations SET name='Renamed Lab',address='Other street',phone='+355999' WHERE id=$1",
      [a.organizationId],
    );
    await db.query(
      "UPDATE lab_orders SET ordering_physician_name='Dr Later',clinical_notes='After issuance' WHERE id=$1",
      [issued.id],
    );
    await db.query(
      "UPDATE lab_specimens SET collection_notes='Later collection' WHERE order_id=$1",
      [issued.id],
    );
    await updateTest(db, a, gluA.id, {
      data: {
        ...testInput(categoryA.id, unitA.id, 'GLU').data,
        name: 'Glucose later',
        method: 'Changed later',
        is_active: true,
      },
      version: Number(gluA.version),
    });
    const current = issued.results.find((row) => row.is_current)!;
    await amendResult(db, a, current.id, {
      numeric_value: '92',
      reason: 'Clinician requested repeat',
      version: Number(current.version),
    });
    const snapshotOnly = await loadSnapshot(db, reportId);
    assert.deepEqual(snapshotOnly, stored);
    const clinical = clinicalReportFromSnapshot(snapshotOnly);
    assert.equal(clinical.patient.first_name, 'John');
    assert.equal(clinical.patient.last_name, 'Test');
    assert.equal(clinical.organization.name, 'a');
    assert.equal(clinical.organization.address, '1 Lab Street');
    assert.equal(clinical.order.ordering_physician_name, 'Dr Example');
    assert.equal(clinical.notes, '');
    assert.equal(clinical.results[0].test_name, 'GLU');
    assert.equal(clinical.results[0].result_display.includes('85'), true);
    assert.equal(clinical.results[0].numeric_value, '85');
    assert.equal(clinical.results[0].method, 'Hexokinase');
    assert.equal(clinical.results[0].reference_range_display.includes('70'), true);
    assert.equal(clinical.results[0].reference_range_display.includes('99'), true);
    assert.equal(clinical.results[0].flag_display, 'Normal');
    assert.equal(clinical.issuance.report_number, issued.reports[0].report_number);
    assert.equal(clinical.patient.first_name.includes('Changed'), false);
    assert.equal(clinical.results[0].method.includes('Changed'), false);
    assert.equal(clinical.results[0].numeric_value, '85');
    const pdf = await renderReportPdf(snapshotOnly);
    const text = pdfText(pdf);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(text.includes('John'));
    assert.ok(text.includes('Test'));
    assert.ok(text.includes('85'));
    assert.ok(text.includes('Hexokinase'));
    assert.ok(text.includes(issued.reports[0].report_number));
    assert.equal(text.includes('Changed'), false);
    assert.equal(text.includes('Renamed Lab'), false);
    assert.equal(text.includes('Dr Later'), false);
    assert.equal(text.includes('After issuance'), false);
    assert.equal(text.includes('Glucose later'), false);
    const downloaded = await downloadReportPdf(
      withoutLiveClinical(db),
      a,
      reportId,
    );
    const downloadedText = pdfText(downloaded.pdf);
    assert.ok(downloadedText.includes('John'));
    assert.ok(downloadedText.includes('85'));
    assert.equal(downloadedText.includes('Changed'), false);
    const listed = await listReportWork(withoutLiveClinical(db), a, {
      query: 'John',
    });
    const item = listed.reports.find((row) => row.id === reportId);
    assert.equal(item?.patient_first_name, 'John');
    assert.equal(item?.patient_last_name, 'Test');
    assert.equal(item?.order_number, issued.order_number);
    const laterName = await listReportWork(withoutLiveClinical(db), a, {
      query: 'Changed',
    });
    assert.equal(laterName.total, 0);
  } finally {
    await db.close();
  }
});
void test('legacy snapshots render from frozen clinical fields plus row issuance', async () => {
  const snapshot: LabReportSnapshot = {
    schema_version: 1,
    organization: {
      name: 'Legacy Lab',
      slug: 'legacy',
      type: 'CLINIC',
      address: '1 Lab Street',
      phone: '',
      email: '',
      country: 'AL',
    },
    patient: {
      patient_number: 'PAT-000001',
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: '1815-12-10',
      sex: 'FEMALE',
    },
    order: {
      order_number: 'LAB-2026-000001',
      status: 'COMPLETED',
      priority: 'ROUTINE',
      ordered_at: '',
      ordered_by_name: '',
      ordering_physician_name: '',
      clinical_notes: '',
      fasting_status: '',
      external_reference: '',
    },
    specimens: [],
    results: [
      {
        order_test_id: 't',
        result_id: 'r',
        result_version: 1,
        test_code: 'GLU',
        test_name: 'Glucose',
        result_type: 'NUMERIC',
        result_display: '88 mg/dL',
        numeric_value: '88',
        text_value: '',
        boolean_value: '',
        unit_symbol: 'mg/dL',
        method: 'Hexokinase',
        flag: 'NORMAL',
        reference_range_display: '70-99 mg/dL',
        range_lower: '70',
        range_upper: '99',
        range_text: '',
        technically_validated_at: '',
        technically_validated_by_name: '',
        clinically_verified_at: '',
        clinically_verified_by_name: '',
        is_amendment: false,
        amendment_reason: '',
      },
    ],
  };
  const fallback = {
    report_number: 'LAB-2026-000001-R1',
    report_version: 1,
    issued_at: '2026-09-12T07:57:00.000Z',
    issued_by_name: 'Issuer',
    superseded: true,
  };
  const clinical = clinicalReportFromSnapshot(snapshot, fallback);
  assert.equal(clinical.patient.first_name, 'Ada');
  assert.equal(clinical.results[0].flag_display, 'Normal');
  assert.equal(clinical.issuance.report_number, 'LAB-2026-000001-R1');
  assert.equal(clinical.issuance.superseded, true);
  const pdf = await renderReportPdf(snapshot, { fallback });
  const text = pdfText(pdf);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(text.includes('Ada'));
  assert.ok(text.includes('88 mg/dL'));
  assert.ok(text.includes('LAB-2026-000001-R1'));
  assert.ok(text.includes('superseded'));
});

void test('amendment immediately supersedes the current issued report before R2 exists', async () => {
  const { db, a, patientA, gluA } = await fixture();
  try {
    const received = await receivedOrder(db, a, patientA.id, [gluA.id]);
    const verified = await verifyValue(db, a, received, received.tests[0].id, '85');
    const issued = await generateReport(db, a, verified.id, {});
    const r1 = issued.reports.find((row) => row.is_current)!;
    assert.equal(r1.status, 'ISSUED');
    assert.equal(r1.is_current, true);
    const current = issued.results.find((row) => row.is_current)!;
    const amended = await amendResult(db, a, current.id, {
      numeric_value: '92',
      reason: 'Transcription correction',
      version: Number(current.version),
    });
    assert.equal(amended.status, 'IN_PROCESS');
    const history = await listOrderReports(db, a, amended.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].id, r1.id);
    assert.equal(history[0].status, 'SUPERSEDED');
    assert.equal(history[0].is_current, false);
    assert.equal(history[0].successor_id, '');
    const context = await getReportContext(db, a, amended.id);
    assert.equal(context.complete, false);
    assert.equal(context.order_status, 'IN_PROCESS');
    assert.equal(context.needs_new_report, true);
    assert.equal(context.eligible, false);
    assert.equal(context.current_report, null);
    await assert.rejects(
      generateReport(db, a, amended.id, {}),
      hasCode('ORDER_NOT_COMPLETE'),
    );
    const stalePdf = await downloadReportPdf(db, a, r1.id);
    const staleText = pdfText(stalePdf.pdf);
    assert.ok(staleText.includes('85'));
    assert.equal(staleText.includes('92'), false);
    assert.ok(staleText.includes('no longer the current official report'));
    const frozen = await loadSnapshot(db, r1.id);
    assert.equal(frozen.results[0].numeric_value, '85');
    const superseded = (
      await db.query<{ metadata: string }>(
        `SELECT metadata::text AS metadata FROM audit_events
 WHERE entity_type='LAB_REPORT' AND entity_id=$1 AND action='LAB_REPORT_SUPERSEDED'`,
        [r1.id],
      )
    ).rows;
    assert.equal(superseded.length, 1);
    assert.equal(JSON.parse(superseded[0].metadata).successor_id, null);
    const latest = amended.results.find((row) => row.is_current)!;
    const recompleted = await verifyValue(
      db,
      a,
      amended,
      latest.order_test_id,
      latest.numeric_value,
    );
    assert.equal(recompleted.status, 'COMPLETED');
    const readyContext = await getReportContext(db, a, recompleted.id);
    assert.equal(readyContext.complete, true);
    assert.equal(readyContext.needs_new_report, true);
    assert.equal(readyContext.eligible, true);
    const v2 = await generateReport(db, a, recompleted.id, {});
    const currentReport = v2.reports.find((row) => row.is_current)!;
    const previous = v2.reports.find((row) => !row.is_current)!;
    assert.equal(currentReport.report_version, 2);
    assert.equal(currentReport.status, 'ISSUED');
    assert.equal(previous.id, r1.id);
    assert.equal(previous.status, 'SUPERSEDED');
    assert.equal(currentReport.supersedes_id, previous.id);
    assert.equal(previous.successor_id, currentReport.id);
    assert.equal(v2.reports.filter((row) => row.is_current).length, 1);
    const afterContext = await getReportContext(db, a, v2.id);
    assert.equal(afterContext.needs_new_report, false);
    assert.equal(afterContext.current_report?.id, currentReport.id);
    const historical = await downloadReportPdf(db, a, previous.id);
    const historicalText = pdfText(historical.pdf);
    assert.ok(historicalText.includes('85'));
    assert.ok(historicalText.includes('no longer the current official report'));
    const currentPdf = await downloadReportPdf(db, a, currentReport.id);
    const currentText = pdfText(currentPdf.pdf);
    assert.ok(currentText.includes('92'));
    assert.equal(currentText.includes('no longer the current official report'), false);
    const generated = (
      await db.query<{ metadata: string }>(
        `SELECT metadata::text AS metadata FROM audit_events
 WHERE entity_type='LAB_REPORT' AND entity_id=$1 AND action='LAB_REPORT_GENERATED'`,
        [currentReport.id],
      )
    ).rows[0];
    assert.equal(JSON.parse(generated.metadata).supersedes_id, previous.id);
    const r1Snapshot = await loadSnapshot(db, r1.id);
    assert.equal(r1Snapshot.results[0].numeric_value, '85');
    const r2CurrentResult = v2.results.find((row) => row.is_current)!;
    const amendedAgain = await amendResult(db, a, r2CurrentResult.id, {
      numeric_value: '95',
      reason: 'Second amendment after R2',
      version: Number(r2CurrentResult.version),
    });
    assert.equal(amendedAgain.status, 'IN_PROCESS');
    const afterSecond = await listOrderReports(db, a, amendedAgain.id);
    const r2After = afterSecond.find((row) => row.id === currentReport.id)!;
    assert.equal(r2After.status, 'SUPERSEDED');
    assert.equal(r2After.is_current, false);
    assert.equal(afterSecond.filter((row) => row.is_current).length, 0);
    const secondContext = await getReportContext(db, a, amendedAgain.id);
    assert.equal(secondContext.needs_new_report, true);
    await assert.rejects(
      generateReport(db, a, amendedAgain.id, {}),
      hasCode('ORDER_NOT_COMPLETE'),
    );
    const latestAgain = amendedAgain.results.find((row) => row.is_current)!;
    const recompletedAgain = await verifyValue(
      db,
      a,
      amendedAgain,
      latestAgain.order_test_id,
      latestAgain.numeric_value,
    );
    const v3 = await generateReport(db, a, recompletedAgain.id, {});
    const r3 = v3.reports.find((row) => row.is_current)!;
    const r2Historical = v3.reports.find((row) => row.id === currentReport.id)!;
    const r1Historical = v3.reports.find((row) => row.id === r1.id)!;
    assert.equal(r3.report_version, 3);
    assert.equal(r3.status, 'ISSUED');
    assert.equal(r3.supersedes_id, r2Historical.id);
    assert.equal(r2Historical.successor_id, r3.id);
    assert.equal(r1Historical.status, 'SUPERSEDED');
    assert.equal(r1Historical.is_current, false);
    assert.equal(v3.reports.filter((row) => row.is_current).length, 1);
    assert.equal((await loadSnapshot(db, r1.id)).results[0].numeric_value, '85');
    assert.equal((await loadSnapshot(db, r2Historical.id)).results[0].numeric_value, '92');
    const r3Text = pdfText((await downloadReportPdf(db, a, r3.id)).pdf);
    assert.ok(r3Text.includes('95'));
    assert.equal(r3Text.includes('no longer the current official report'), false);
  } finally {
    await db.close();
  }
});
