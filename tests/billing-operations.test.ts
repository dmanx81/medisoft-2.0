import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPatient } from '../features/patients/repository';
import {
  createCategory,
  createTest,
  createUnit,
} from '../features/catalogue/repository';
import { createOrder } from '../features/orders/repository';
import {
  cancelInvoice,
  createCreditNote,
  createInvoice,
  downloadPaymentReceipt,
  emailInvoice,
  getBillingSettings,
  getCreditNote,
  getInvoice,
  issueCreditNote,
  issueInvoice,
  recordPayment,
  reversePayment,
  updateBillingSettings,
  updateInvoice,
} from '../features/billing/repository';
import { deriveInvoiceLedger } from '../features/billing/ledger';
import {
  StubBillingEmailProvider,
  setBillingEmailProvider,
} from '../features/billing/email';
import { BillingError } from '../features/billing/types';
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
    '009_billing_operations.sql',
  ])
    await db.exec(
      await readFile(
        new URL(`../db/migrations/${name}`, import.meta.url),
        'utf8',
      ),
    );
  const principals: Principal[] = [];
  for (const slug of ['ops-a', 'ops-b']) {
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
  const categoryA = await createCategory(db, a, {
    code: 'BIOCHEMISTRY',
    name: 'Biochemistry',
  });
  const unitA = await createUnit(db, a, {
    symbol: 'mg/dL',
    name: 'Milligrams per decilitre',
    code: 'MG_DL',
  });
  const gluA = await createTest(db, a, {
    data: {
      code: 'GLU',
      name: 'Glucose',
      short_name: 'Glu',
      category_id: categoryA.id,
      description: '',
      specimen_type: 'SERUM',
      result_type: 'NUMERIC',
      unit_id: unitA.id,
      method: 'Hexokinase',
      display_order: 10,
      base_price: '8.00',
      is_active: true,
    },
  });
  return { db, a, b, patientA, gluA };
}
const hasCode = (code: string) => (error: unknown) =>
  error instanceof BillingError && error.code === code;
async function issuedInvoice(
  db: PGlite,
  principal: Principal,
  patientId: string,
  testId: string,
  dueDate = '',
) {
  const order = await createOrder(db, principal, {
    data: {
      patient_id: patientId,
      priority: 'ROUTINE',
      ordering_physician_name: 'Dr Example',
      clinical_notes: '',
      fasting_status: 'UNKNOWN',
      external_reference: '',
      test_ids: [testId],
    },
  });
  const draft = await createInvoice(db, principal, order.id, {});
  const ready = dueDate
    ? await updateInvoice(db, principal, draft.id, {
        discount_type: 'NONE',
        discount_value: '0',
        tax_rate: draft.tax_rate,
        notes: '',
        due_date: dueDate,
        version: draft.version,
      })
    : draft;
  return issueInvoice(db, principal, ready.id, { version: ready.version });
}
async function paymentId(db: PGlite, invoiceId: string) {
  return (
    await db.query<{ id: string; amount: string }>(
      'SELECT id,amount::text FROM lab_invoice_payments WHERE invoice_id=$1',
      [invoiceId],
    )
  ).rows[0];
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
      if (
        liveMutableTables.test(sql) &&
        /FROM|JOIN/i.test(sql) &&
        !/lab_invoices|lab_invoice_payments|lab_invoice_payment_reversals|lab_credit_notes|lab_invoice_deliveries|audit_events/i.test(
          sql,
        )
      )
        throw new Error(`Live table read is not allowed: ${sql}`);
      return db.query(sql, values);
    },
  };
}

void test('ledger derivation uses integer cents and never exceeds billed total', () => {
  const ledger = deriveInvoiceLedger({
    billed_total: '8.00',
    gross_paid: '8.00',
    reversed: '3.00',
    credited: '2.00',
  });
  assert.equal(ledger.net_paid, '5.00');
  assert.equal(ledger.balance_due, '1.00');
  assert.equal(ledger.payment_status, 'PARTIALLY_PAID');
  assert.equal(
    deriveInvoiceLedger({
      billed_total: '8.00',
      gross_paid: '8.00',
      reversed: '0.00',
      credited: '0.00',
    }).payment_status,
    'PAID',
  );
  assert.equal(
    deriveInvoiceLedger({
      billed_total: '8.00',
      gross_paid: '8.00',
      reversed: '8.00',
      credited: '0.00',
    }).payment_status,
    'ISSUED',
  );
  assert.throws(() =>
    deriveInvoiceLedger({
      billed_total: '8.00',
      gross_paid: '5.00',
      reversed: '0.00',
      credited: '4.00',
    }),
  );
});

void test('payment reversals are immutable additional records and recalculate status', async () => {
  const { db, a, b, patientA, gluA } = await fixture();
  try {
    const issued = await issuedInvoice(db, a, patientA.id, gluA.id);
    const paid = await recordPayment(db, a, issued.id, {
      amount: '8.00',
      method: 'CASH',
      reference: 'desk',
      notes: '',
      version: issued.version,
    });
    assert.equal(paid.status, 'PAID');
    const payment = await paymentId(db, paid.id);
    const original = (
      await db.query<{ amount: string; method: string }>(
        'SELECT amount::text,method FROM lab_invoice_payments WHERE id=$1',
        [payment.id],
      )
    ).rows[0];
    const partial = await reversePayment(db, a, payment.id, {
      amount: '3.00',
      reason: 'Change given twice',
      version: paid.version,
    });
    assert.equal(partial.status, 'PARTIALLY_PAID');
    assert.equal(partial.amount_paid, '5.00');
    assert.equal(partial.credit_total, '0.00');
    assert.equal(partial.balance_due, '3.00');
    assert.equal(partial.total, '8.00');
    const unchanged = (
      await db.query<{ amount: string; method: string }>(
        'SELECT amount::text,method FROM lab_invoice_payments WHERE id=$1',
        [payment.id],
      )
    ).rows[0];
    assert.deepEqual(unchanged, original);
    await assert.rejects(
      reversePayment(db, a, payment.id, {
        amount: '6.00',
        reason: 'Too much',
        version: partial.version,
      }),
      hasCode('REVERSAL_EXCEEDS_PAYMENT'),
    );
    const remaining = await reversePayment(db, a, payment.id, {
      amount: '5.00',
      reason: 'Full remaining reversal',
      version: partial.version,
    });
    assert.equal(remaining.status, 'ISSUED');
    assert.equal(remaining.amount_paid, '0.00');
    assert.equal(remaining.balance_due, '8.00');
    await assert.rejects(
      reversePayment(db, a, payment.id, {
        amount: '0.01',
        reason: 'Already reversed',
        version: remaining.version,
      }),
      hasCode('REVERSAL_EXCEEDS_PAYMENT'),
    );
    await assert.rejects(
      reversePayment(db, b, payment.id, {
        amount: '1.00',
        reason: 'Cross tenant',
        version: remaining.version,
      }),
      hasCode('PAYMENT_NOT_FOUND'),
    );
    const receptionist: Principal = { ...a, role: 'RECEPTIONIST' };
    await assert.rejects(
      reversePayment(db, receptionist, payment.id, {
        amount: '1.00',
        reason: 'Front desk',
        version: remaining.version,
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      db.exec('DELETE FROM lab_invoice_payment_reversals'),
      /append-only/,
    );
    await assert.rejects(
      db.query('UPDATE lab_invoice_payment_reversals SET amount=1'),
      /append-only/,
    );
    const events = (
      await db.query<{ action: string }>(
        "SELECT action FROM audit_events WHERE entity_id=$1 AND action='LAB_PAYMENT_REVERSED'",
        [issued.id],
      )
    ).rows;
    assert.equal(events.length, 2);
  } finally {
    await db.close();
  }
});

void test('credit notes are numbered, immutable after issue, and cannot over-credit', async () => {
  const { db, a, b, patientA, gluA } = await fixture();
  try {
    const issued = await issuedInvoice(db, a, patientA.id, gluA.id);
    const billed = issued.total;
    const snapshotTotal = (issued.snapshot as { totals: { total: string } }).totals.total;
    const draftNote = await createCreditNote(db, a, issued.id, {
      amount: '3.00',
      reason: 'Pricing goodwill',
      notes: '',
      version: issued.version,
    });
    assert.equal(draftNote.status, 'DRAFT');
    assert.equal(draftNote.credit_note_number, '');
    const afterDraft = await getInvoice(db, a, issued.id);
    assert.equal(afterDraft.credit_total, '0.00');
    assert.equal(afterDraft.status, 'ISSUED');
    const issuedNote = await issueCreditNote(db, a, draftNote.id, {
      version: draftNote.version,
    });
    assert.match(issuedNote.credit_note_number, /^CN-20[0-9]{2}-000001$/);
    assert.equal(issuedNote.status, 'ISSUED');
    const ledger = await getInvoice(db, a, issued.id);
    assert.equal(ledger.status, 'PARTIALLY_PAID');
    assert.equal(ledger.credit_total, '3.00');
    assert.equal(ledger.balance_due, '5.00');
    assert.equal(ledger.total, billed);
    assert.equal(
      (ledger.snapshot as { totals: { total: string } }).totals.total,
      snapshotTotal,
    );
    await assert.rejects(
      issueCreditNote(db, a, issuedNote.id, { version: issuedNote.version }),
      hasCode('CREDIT_NOTE_NOT_DRAFT'),
    );
    await assert.rejects(
      createCreditNote(db, a, issued.id, {
        amount: '6.00',
        reason: 'Too large',
        notes: '',
        version: ledger.version,
      }),
      hasCode('CREDIT_EXCEEDS_BALANCE'),
    );
    const second = await createCreditNote(db, a, issued.id, {
      amount: '5.00',
      reason: 'Write off remainder',
      notes: '',
      version: ledger.version,
    });
    const secondIssued = await issueCreditNote(db, a, second.id, {
      version: second.version,
    });
    assert.match(secondIssued.credit_note_number, /^CN-20[0-9]{2}-000002$/);
    const settled = await getInvoice(db, a, issued.id);
    assert.equal(settled.status, 'PAID');
    assert.equal(settled.credit_total, '8.00');
    assert.equal(settled.amount_paid, '0.00');
    assert.equal(settled.balance_due, '0.00');
    assert.equal(settled.total, '8.00');
    await assert.rejects(
      getCreditNote(db, b, issuedNote.id),
      hasCode('CREDIT_NOTE_NOT_FOUND'),
    );
    await assert.rejects(db.exec('DELETE FROM lab_credit_notes'), /not deleted/);
    const cancelled = await issuedInvoice(db, a, patientA.id, gluA.id);
    const cancelledInvoice = await cancelInvoice(db, a, cancelled.id, {
      reason: 'Withdrawn',
      version: cancelled.version,
    });
    await assert.rejects(
      createCreditNote(db, a, cancelledInvoice.id, {
        amount: '1.00',
        reason: 'No',
        notes: '',
        version: cancelledInvoice.version,
      }),
      hasCode('INVOICE_NOT_CORRECTABLE'),
    );
    const receptionist: Principal = { ...a, role: 'RECEPTIONIST' as Role };
    await assert.rejects(
      createCreditNote(db, receptionist, settled.id, {
        amount: '1.00',
        reason: 'No',
        notes: '',
        version: settled.version,
      }),
      hasCode('FORBIDDEN'),
    );
  } finally {
    await db.close();
  }
});

void test('receipts, due dates, settings and email keep issued invoices frozen', async () => {
  const { db, a, b, patientA, gluA } = await fixture();
  const mail = new StubBillingEmailProvider();
  setBillingEmailProvider(mail);
  try {
    const issued = await issuedInvoice(
      db,
      a,
      patientA.id,
      gluA.id,
      '2020-01-01',
    );
    assert.equal(issued.due_date, '2020-01-01');
    assert.equal(
      (issued.snapshot as { invoice: { due_date?: string } }).invoice.due_date,
      '2020-01-01',
    );
    assert.equal(issued.overdue, true);
    await assert.rejects(
      updateInvoice(db, a, issued.id, {
        discount_type: 'NONE',
        discount_value: '0',
        tax_rate: issued.tax_rate,
        notes: '',
        due_date: '2030-01-01',
        version: issued.version,
      }),
      hasCode('INVOICE_NOT_DRAFT'),
    );
    const paid = await recordPayment(db, a, issued.id, {
      amount: '8.00',
      method: 'CASH',
      reference: 'desk',
      notes: '',
      version: issued.version,
    });
    const payment = await paymentId(db, paid.id);
    const reversed = await reversePayment(db, a, payment.id, {
      amount: '3.00',
      reason: 'Partial refund at desk',
      version: paid.version,
    });
    assert.equal(reversed.status, 'PARTIALLY_PAID');
    const { pdf } = await downloadPaymentReceipt(
      withoutLiveJoins(db),
      a,
      payment.id,
    );
    const text = pdfText(pdf);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.match(text, /Payment receipt/);
    assert.match(text, /INV-/);
    assert.match(text, /8\.00/);
    assert.match(text, /Subsequent reversals/);
    assert.match(text, /Partial refund at desk/);
    await assert.rejects(
      downloadPaymentReceipt(withoutLiveJoins(db), b, payment.id),
      hasCode('PAYMENT_NOT_FOUND'),
    );
    const note = await createCreditNote(db, a, reversed.id, {
      amount: '2.00',
      reason: 'Courtesy credit',
      notes: '',
      version: reversed.version,
    });
    const issuedNote = await issueCreditNote(db, a, note.id, {
      version: note.version,
    });
    assert.equal(issuedNote.status, 'ISSUED');
    const afterCredit = await getInvoice(db, a, reversed.id);
    assert.equal(afterCredit.total, '8.00');
    assert.equal(afterCredit.amount_paid, '5.00');
    assert.equal(afterCredit.credit_total, '2.00');
    assert.equal(afterCredit.balance_due, '1.00');
    const emailed = await emailInvoice(db, a, afterCredit.id, {
      recipient: 'accounts@example.test',
      version: afterCredit.version,
    });
    assert.equal(emailed.invoice_number, afterCredit.invoice_number);
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, 'accounts@example.test');
    assert.equal(mail.sent[0].attachments[0].contentType, 'application/pdf');
    const before = await getBillingSettings(db, a);
    assert.equal(before.currency, 'ALL');
    await updateBillingSettings(db, a, {
      currency: 'EUR',
      default_tax_rate: '10.00',
    });
    const frozen = await getInvoice(db, a, afterCredit.id);
    assert.equal(frozen.currency, 'ALL');
    assert.equal(frozen.tax_rate, '0.00');
    const order = await createOrder(db, a, {
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
    const draft = await createInvoice(db, a, order.id, {});
    assert.equal(draft.currency, 'EUR');
    assert.equal(draft.tax_rate, '10.00');
    await assert.rejects(
      updateBillingSettings(db, { ...a, role: 'RECEPTIONIST' }, {
        currency: 'USD',
        default_tax_rate: '5.00',
      }),
      hasCode('FORBIDDEN'),
    );
    await assert.rejects(
      emailInvoice(db, b, afterCredit.id, {
        recipient: 'other@example.test',
        version: afterCredit.version,
      }),
      hasCode('INVOICE_NOT_FOUND'),
    );
    await assert.rejects(db.exec('DELETE FROM lab_invoice_deliveries'), /append-only/);
    const actions = (
      await db.query<{ action: string }>(
        `SELECT action FROM audit_events WHERE organization_id=$1
 AND action IN ('LAB_RECEIPT_DOWNLOADED','LAB_CREDIT_NOTE_CREATED','LAB_CREDIT_NOTE_ISSUED','LAB_INVOICE_EMAILED','BILLING_SETTINGS_UPDATED')
 ORDER BY occurred_at,id`,
        [a.organizationId],
      )
    ).rows.map((row) => row.action);
    assert.ok(actions.includes('LAB_RECEIPT_DOWNLOADED'));
    assert.ok(actions.includes('LAB_CREDIT_NOTE_ISSUED'));
    assert.ok(actions.includes('LAB_INVOICE_EMAILED'));
    assert.ok(actions.includes('BILLING_SETTINGS_UPDATED'));
  } finally {
    await db.close();
  }
});
