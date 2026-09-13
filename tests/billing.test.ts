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
import { createOrder } from '../features/orders/repository';
import {
  calculateInvoiceTotals,
  cancelInvoice,
  createInvoice,
  downloadInvoicePdf,
  getInvoice,
  getInvoiceContext,
  issueInvoice,
  listInvoiceWork,
  recordPayment,
  updateInvoice,
} from '../features/billing/repository';
import { invoiceFromSnapshot } from '../features/billing/snapshot';
import { formatMoney, parseMoney, percentOf } from '../features/billing/money';
import { BillingError } from '../features/billing/types';
import type { LabInvoiceSnapshot } from '../features/billing/types';
import { emptyPatient } from '../features/patients/validation';
import type { Principal, Role } from '../lib/auth/permissions';
import type { QueryRunner } from '../lib/db/query';
async function fixture() {
  const db = new PGlite();
  for (const name of [
    '001_foundation.sql',
    '002_patient_crm.sql',
    '003_lab_catalogue.sql',
    '004_lab_orders_specimens.sql',
    '005_lab_results.sql',
    '006_lab_reports.sql',
    '007_report_sharing.sql',
    '008_billing.sql',
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
  const gluA = await createTest(db, a, testInput(categoryA.id, unitA.id, 'GLU', { name: 'Glucose', base_price: '8.00' }));
  const altA = await createTest(db, a, testInput(categoryA.id, unitA.id, 'ALT', { name: 'Alanine aminotransferase', base_price: '7.00' }));
  const gluB = await createTest(db, b, testInput(categoryB.id, unitB.id, 'GLU', { name: 'Glucose', base_price: '8.00' }));
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
const hasCode = (code: string) => (error: unknown) =>
  error instanceof BillingError && error.code === code;
async function orderWithTests(
  db: PGlite,
  principal: Principal,
  patientId: string,
  testIds: string[],
) {
  return createOrder(db, principal, {
    data: {
      patient_id: patientId,
      priority: 'ROUTINE',
      ordering_physician_name: 'Dr Example',
      clinical_notes: '',
      fasting_status: 'UNKNOWN',
      external_reference: '',
      test_ids: testIds,
    },
  });
}
function loadSnapshot(invoice: { snapshot: LabInvoiceSnapshot | Record<string, never> }) {
  return invoiceFromSnapshot(invoice.snapshot as LabInvoiceSnapshot);
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
const liveMutableTables =
  /\b(patients|lab_orders|lab_order_tests|lab_tests|organizations)\b/i;
function withoutLiveJoins(db: PGlite): QueryRunner {
  return {
    query(sql, values) {
      if (liveMutableTables.test(sql) && /FROM|JOIN/i.test(sql) && !/lab_invoices|lab_invoice_payments|audit_events/i.test(sql))
        throw new Error(`Live table read is not allowed: ${sql}`);
      return db.query(sql, values);
    },
  };
}

void test('invoice totals use exact cents and documented rounding', () => {
  const totals = calculateInvoiceTotals({
    lines: [
      {
        order_test_id: '1',
        code: 'GLU',
        name: 'Glucose',
        quantity: '1.00',
        unit_price: '8.00',
      },
      {
        order_test_id: '2',
        code: 'ALT',
        name: 'ALT',
        quantity: '1.00',
        unit_price: '7.00',
      },
    ],
    discount_type: 'PERCENT',
    discount_value: '10.00',
    tax_rate: '20.00',
  });
  assert.equal(totals.subtotal, '15.00');
  assert.equal(totals.discount_total, '1.50');
  assert.equal(totals.taxable, '13.50');
  assert.equal(totals.tax_total, '2.70');
  assert.equal(totals.total, '16.20');
  assert.equal(formatMoney(parseMoney('1.2')), '1.20');
  assert.equal(percentOf(125n, '0.50'), 1n);
});

void test('draft invoices bill active order-test snapshots and exclude cancelled tests', async () => {
  const { db, a, patientA, gluA, altA } = await fixture();
  try {
    const order = await orderWithTests(db, a, patientA.id, [gluA.id, altA.id]);
    await db.query(
      "UPDATE lab_order_tests SET status='CANCELLED' WHERE organization_id=$1 AND id=$2",
      [a.organizationId, order.tests[1].id],
    );
    const created = await createInvoice(db, a, order.id, {});
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.invoice_number, '');
    assert.equal(created.subtotal, '8.00');
    assert.equal(created.currency, 'ALL');
    assert.equal((created.snapshot as LabInvoiceSnapshot).lines.length, 1);
    assert.equal((created.snapshot as LabInvoiceSnapshot).lines[0].code, 'GLU');
    await assert.rejects(createInvoice(db, a, order.id, {}), hasCode('INVOICE_EXISTS'));
    const missing = await orderWithTests(db, a, patientA.id, [gluA.id, altA.id]);
    await db.query(
      "UPDATE lab_order_tests SET status='CANCELLED' WHERE organization_id=$1 AND order_id=$2",
      [a.organizationId, missing.id],
    );
    await assert.rejects(createInvoice(db, a, missing.id, {}), hasCode('NOT_BILLABLE'));
  } finally {
    await db.close();
  }
});

void test('issue freezes snapshot, numbering, discounts and payments without rewriting billed totals', async () => {
  const { db, a, b, patientA, gluA, altA, unitA, categoryA } = await fixture();
  try {
    const order = await orderWithTests(db, a, patientA.id, [gluA.id, altA.id]);
    const draft = await createInvoice(db, a, order.id, {});
    const updated = await updateInvoice(db, a, draft.id, {
      discount_type: 'FIXED',
      discount_value: '5.00',
      tax_rate: '20.00',
      notes: 'Clinic discount',
      version: draft.version,
    });
    assert.equal(updated.subtotal, '15.00');
    assert.equal(updated.discount_total, '5.00');
    assert.equal(updated.tax_total, '2.00');
    assert.equal(updated.total, '12.00');
    const issued = await issueInvoice(db, a, updated.id, { version: updated.version });
    assert.equal(issued.status, 'ISSUED');
    assert.match(issued.invoice_number, /^INV-20[0-9]{2}-000001$/);
    const snapshot = loadSnapshot(issued);
    assert.equal(snapshot.patient.first_name, 'John');
    assert.equal(snapshot.lines[0].name, 'Glucose');
    assert.equal(snapshot.lines[0].unit_price, '8.00');
    assert.equal(snapshot.organization.name, 'a');
    await assert.rejects(
      issueInvoice(db, a, issued.id, { version: issued.version }),
      hasCode('INVOICE_NOT_DRAFT'),
    );
    await db.query("UPDATE patients SET first_name='ChangedLive', last_name='Othername' WHERE id=$1", [
      patientA.id,
    ]);
    await db.query("UPDATE organizations SET name='Renamed Lab' WHERE id=$1", [
      a.organizationId,
    ]);
    await updateTest(db, a, gluA.id, {
      data: {
        ...testInput(categoryA.id, unitA.id, 'GLU', {
          name: 'Glucose changed',
          base_price: '99.00',
        }).data,
      },
      version: Number(gluA.version),
    });
    const frozen = await getInvoice(db, a, issued.id);
    const frozenSnapshot = loadSnapshot(frozen);
    assert.equal(frozenSnapshot.patient.first_name, 'John');
    assert.equal(frozenSnapshot.patient.last_name, 'Test');
    assert.equal(frozenSnapshot.lines[0].name, 'Glucose');
    assert.equal(frozenSnapshot.lines[0].unit_price, '8.00');
    assert.equal(frozenSnapshot.organization.name, 'a');
    assert.equal(frozen.total, '12.00');
    const listed = await listInvoiceWork(db, a, { query: 'John' });
    assert.equal(listed.total, 1);
    assert.equal(listed.invoices[0].patient_first_name, 'John');
    const renamed = await listInvoiceWork(db, a, { query: 'ChangedLive' });
    assert.equal(renamed.total, 0);
    const { pdf } = await downloadInvoicePdf(withoutLiveJoins(db), a, issued.id);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    const text = pdfText(pdf);
    assert.match(text, /John/);
    assert.match(text, /Glucose/);
    assert.doesNotMatch(text, /ChangedLive/);
    assert.doesNotMatch(text, /Glucose changed/);
    const partial = await recordPayment(db, a, issued.id, {
      amount: '5.00',
      method: 'CASH',
      reference: 'desk-1',
      notes: '',
      version: frozen.version,
    });
    assert.equal(partial.status, 'PARTIALLY_PAID');
    assert.equal(partial.amount_paid, '5.00');
    assert.equal(partial.balance_due, '7.00');
    assert.equal(loadSnapshot(partial).totals.total, '12.00');
    await assert.rejects(
      recordPayment(db, a, partial.id, {
        amount: '8.00',
        method: 'CARD',
        reference: '',
        notes: '',
        version: partial.version,
      }),
      hasCode('PAYMENT_EXCEEDS_BALANCE'),
    );
    const paid = await recordPayment(db, a, partial.id, {
      amount: '7.00',
      method: 'BANK_TRANSFER',
      reference: 'TRX',
      notes: '',
      version: partial.version,
    });
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.balance_due, '0.00');
    assert.equal(paid.total, '12.00');
    await assert.rejects(
      cancelInvoice(db, a, paid.id, { reason: 'too late', version: paid.version }),
      hasCode('INVOICE_NOT_CANCELLABLE'),
    );
    await assert.rejects(getInvoice(db, b, issued.id), hasCode('INVOICE_NOT_FOUND'));
    const asRole = (role: Role): Principal => ({ ...a, role });
    await assert.rejects(createInvoice(db, asRole('DOCTOR'), order.id, {}), hasCode('FORBIDDEN'));
    await assert.rejects(
      recordPayment(db, asRole('LAB_TECHNICIAN'), paid.id, {
        amount: '1.00',
        method: 'CASH',
        reference: '',
        notes: '',
        version: paid.version,
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(db.exec('DELETE FROM lab_invoices'), /not deleted/);
    await assert.rejects(db.exec('DELETE FROM lab_invoice_payments'), /append-only/);
    await assert.rejects(
      db.query('UPDATE lab_invoice_payments SET amount=1'),
      /append-only/,
    );
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_id=$1 ORDER BY occurred_at,id",
        [issued.id],
      )
    ).rows.map((row) => row.action);
    assert.ok(events.includes('LAB_INVOICE_CREATED'));
    assert.ok(events.includes('LAB_INVOICE_ISSUED'));
    assert.ok(events.includes('LAB_PAYMENT_RECORDED'));
    assert.ok(events.includes('LAB_INVOICE_DOWNLOADED'));
  } finally {
    await db.close();
  }
});

void test('unpaid issued invoices can be cancelled and replaced; drafts stay unnumbered', async () => {
  const { db, a, patientA, gluA } = await fixture();
  try {
    const firstOrder = await orderWithTests(db, a, patientA.id, [gluA.id]);
    const draft = await createInvoice(db, a, firstOrder.id, {});
    const cancelledDraft = await cancelInvoice(db, a, draft.id, {
      reason: 'Created in error',
      version: draft.version,
    });
    assert.equal(cancelledDraft.status, 'CANCELLED');
    assert.equal(cancelledDraft.invoice_number, '');
    const replacement = await createInvoice(db, a, firstOrder.id, {});
    const issued = await issueInvoice(db, a, replacement.id, {
      version: replacement.version,
    });
    const cancelledIssued = await cancelInvoice(db, a, issued.id, {
      reason: 'Patient withdrew',
      version: issued.version,
    });
    assert.equal(cancelledIssued.status, 'CANCELLED');
    assert.match(cancelledIssued.invoice_number, /^INV-/);
    const context = await getInvoiceContext(db, a, firstOrder.id);
    assert.equal(context.invoice, null);
    const third = await createInvoice(db, a, firstOrder.id, {});
    assert.equal(third.status, 'DRAFT');
    await assert.rejects(
      recordPayment(db, a, cancelledIssued.id, {
        amount: '1.00',
        method: 'CASH',
        reference: '',
        notes: '',
        version: cancelledIssued.version,
      }),
      hasCode('INVOICE_NOT_PAYABLE'),
    );
  } finally {
    await db.close();
  }
});
