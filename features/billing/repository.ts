import type { QueryRunner } from '@/lib/db/query';
import { can, type Permission, type Principal } from '@/lib/auth/permissions';
import { getOrder } from '@/features/orders/repository';
import { OrderError } from '@/features/orders/types';
import {
  calculateInvoiceTotals,
  parseMoney,
  formatMoney,
  ZERO_CENTS,
  type DiscountType,
} from './money';
import { deriveInvoiceLedger, invoiceIsOverdue } from './ledger';
import { BillingEmailError, billingEmailProvider } from './email';
import { renderInvoicePdf, renderReceiptPdf } from './pdf';
import { buildInvoiceSnapshot, invoiceFromSnapshot, loadBillableLines } from './snapshot';
import {
  cancelInvoiceSchema,
  createCreditNoteSchema,
  createInvoiceSchema,
  emailInvoiceSchema,
  fieldErrors,
  invoiceIdSchema,
  issueCreditNoteSchema,
  issueInvoiceSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  searchSchema,
  updateBillingSettingsSchema,
  updateInvoiceSchema,
} from './validation';
import {
  BillingError,
  type InvoiceContext,
  type InvoiceWorkItem,
  type LabCreditNote,
  type LabCreditNoteSnapshot,
  type LabInvoice,
  type LabInvoiceDelivery,
  type LabInvoicePayment,
  type LabInvoiceSnapshot,
  type LabPaymentReversal,
  type OrganizationBillingSettings,
} from './types';

export const invoiceSelect = `i.id,i.organization_id,i.order_id,i.patient_id,i.invoice_number,i.status,
 i.currency,i.discount_type,i.discount_value::text,i.tax_rate::text,i.notes,i.subtotal::text,
 i.discount_total::text,i.tax_total::text,i.total::text,i.amount_paid::text,i.credit_total::text,
 i.balance_due::text,COALESCE(i.due_date::text,'') AS due_date,
 COALESCE(i.issued_at::text,'') AS issued_at,COALESCE(i.issued_by::text,'') AS issued_by,
 COALESCE(iss.name,'') AS issued_by_name,COALESCE(i.cancelled_at::text,'') AS cancelled_at,
 COALESCE(i.cancelled_by::text,'') AS cancelled_by,COALESCE(cb.name,'') AS cancelled_by_name,
 i.cancellation_reason,i.created_at::text,i.updated_at::text,i.created_by,i.updated_by,i.version,
 i.snapshot`;

function permit(principal: Principal, permission: Permission) {
  if (!principal.organizationId || !can(principal.role, permission))
    throw new BillingError(
      403,
      'FORBIDDEN',
      'Your role does not allow this action.',
    );
}
function idValue(id: string, code = 'INVOICE_NOT_FOUND', label = 'Invoice') {
  if (!invoiceIdSchema.safeParse(id).success)
    throw new BillingError(404, code, `${label} not found.`);
  return id;
}
function notFound(code = 'INVOICE_NOT_FOUND', label = 'Invoice'): never {
  throw new BillingError(404, code, `${label} not found.`);
}
function invalid(error: Parameters<typeof fieldErrors>[0]): never {
  throw new BillingError(
    400,
    'VALIDATION',
    'Check the highlighted fields.',
    fieldErrors(error),
  );
}
function stale(): never {
  throw new BillingError(
    409,
    'STALE_VERSION',
    'This invoice changed. Reload and try again.',
  );
}
function parseSnapshot(
  value: LabInvoiceSnapshot | Record<string, never> | string,
): LabInvoiceSnapshot | Record<string, never> {
  return typeof value === 'string' ? (JSON.parse(value) as LabInvoiceSnapshot) : value;
}
function mapInvoice(row: LabInvoice): LabInvoice {
  const invoice = {
    ...row,
    version: Number(row.version),
    snapshot: parseSnapshot(row.snapshot),
    credit_total: row.credit_total || '0.00',
    due_date: row.due_date || '',
  };
  return {
    ...invoice,
    overdue: invoiceIsOverdue({
      status: invoice.status,
      due_date: invoice.due_date,
      balance_due: invoice.balance_due,
    }),
  };
}
function mapPayment(row: LabInvoicePayment): LabInvoicePayment {
  return { ...row, reversed_amount: row.reversed_amount || '0.00' };
}
function mapCreditNote(row: LabCreditNote): LabCreditNote {
  return {
    ...row,
    version: Number(row.version),
    snapshot:
      typeof row.snapshot === 'string'
        ? (JSON.parse(row.snapshot) as LabCreditNoteSnapshot)
        : row.snapshot,
  };
}
function mapConflict(error: unknown): never {
  if (
    typeof error === 'object' &&
    error &&
    'code' in error &&
    error.code === '23505'
  ) {
    const constraint =
      'constraint' in error ? String(error.constraint) : '';
    if (constraint.includes('lab_invoices_order_active'))
      throw new BillingError(
        409,
        'INVOICE_EXISTS',
        'This order already has an invoice.',
      );
    if (constraint.includes('lab_invoices_number_unique'))
      throw new BillingError(
        409,
        'CONFLICT',
        'An invoice number collision occurred. Please retry.',
      );
    if (constraint.includes('lab_credit_notes_number_unique'))
      throw new BillingError(
        409,
        'CONFLICT',
        'A credit note number collision occurred. Please retry.',
      );
  }
  throw error;
}
async function transaction<T>(
  db: QueryRunner,
  work: () => Promise<T>,
): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    if (error instanceof BillingError) throw error;
    mapConflict(error);
  }
}
async function audit(
  db: QueryRunner,
  principal: Principal,
  entityId: string,
  action: string,
  metadata: Record<string, unknown>,
  entityType = 'LAB_INVOICE',
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      principal.organizationId,
      principal.userId,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata),
      principal.sessionHash,
    ],
  );
}
async function loadInvoice(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabInvoice> {
  const row = (
    await db.query<LabInvoice>(
      `SELECT ${invoiceSelect}
 FROM lab_invoices i
 LEFT JOIN users iss ON iss.organization_id=i.organization_id AND iss.id=i.issued_by
 LEFT JOIN users cb ON cb.organization_id=i.organization_id AND cb.id=i.cancelled_by
 WHERE i.organization_id=$1 AND i.id=$2`,
      [principal.organizationId, id],
    )
  ).rows[0];
  return row ? mapInvoice(row) : notFound();
}
async function listPaymentsForInvoice(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
): Promise<LabInvoicePayment[]> {
  return (
    await db.query<LabInvoicePayment>(
      `SELECT p.id,p.organization_id,p.invoice_id,p.amount::text,p.currency,p.method,p.reference,p.notes,
 p.received_at::text,p.recorded_by,COALESCE(u.name,'') AS recorded_by_name,p.created_at::text,
 COALESCE((
  SELECT SUM(r.amount) FROM lab_invoice_payment_reversals r
  WHERE r.organization_id=p.organization_id AND r.payment_id=p.id
 ),0)::text AS reversed_amount
 FROM lab_invoice_payments p
 JOIN users u ON u.organization_id=p.organization_id AND u.id=p.recorded_by
 WHERE p.organization_id=$1 AND p.invoice_id=$2
 ORDER BY p.received_at,p.id`,
      [principal.organizationId, invoiceId],
    )
  ).rows.map(mapPayment);
}
async function listReversalsForInvoice(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
): Promise<LabPaymentReversal[]> {
  return (
    await db.query<LabPaymentReversal>(
      `SELECT r.id,r.organization_id,r.payment_id,r.invoice_id,r.amount::text,r.currency,r.reason,
 r.recorded_by,COALESCE(u.name,'') AS recorded_by_name,r.created_at::text
 FROM lab_invoice_payment_reversals r
 JOIN users u ON u.organization_id=r.organization_id AND u.id=r.recorded_by
 WHERE r.organization_id=$1 AND r.invoice_id=$2
 ORDER BY r.created_at,r.id`,
      [principal.organizationId, invoiceId],
    )
  ).rows;
}
const creditNoteSelect = `c.id,c.organization_id,c.invoice_id,c.credit_note_number,c.status,c.currency,
 c.reason,c.notes,c.subtotal::text,c.tax_total::text,c.total::text,COALESCE(c.issued_at::text,'') AS issued_at,
 COALESCE(c.issued_by::text,'') AS issued_by,COALESCE(iss.name,'') AS issued_by_name,c.created_at::text,
 c.updated_at::text,c.created_by,c.updated_by,c.version,c.snapshot`;
async function listCreditNotesForInvoice(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
): Promise<LabCreditNote[]> {
  return (
    await db.query<LabCreditNote>(
      `SELECT ${creditNoteSelect}
 FROM lab_credit_notes c
 LEFT JOIN users iss ON iss.organization_id=c.organization_id AND iss.id=c.issued_by
 WHERE c.organization_id=$1 AND c.invoice_id=$2
 ORDER BY COALESCE(c.issued_at,c.created_at),c.id`,
      [principal.organizationId, invoiceId],
    )
  ).rows.map(mapCreditNote);
}
async function listDeliveriesForInvoice(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
): Promise<LabInvoiceDelivery[]> {
  return (
    await db.query<LabInvoiceDelivery>(
      `SELECT d.id,d.organization_id,d.invoice_id,d.method,d.recipient,d.recorded_by,
 COALESCE(u.name,'') AS recorded_by_name,d.occurred_at::text
 FROM lab_invoice_deliveries d
 JOIN users u ON u.organization_id=d.organization_id AND u.id=d.recorded_by
 WHERE d.organization_id=$1 AND d.invoice_id=$2
 ORDER BY d.occurred_at,d.id`,
      [principal.organizationId, invoiceId],
    )
  ).rows;
}
async function ledgerSums(
  db: QueryRunner,
  organizationId: string,
  invoiceId: string,
) {
  const payments = (
    await db.query<{ gross: string; reversed: string }>(
      `SELECT COALESCE((SELECT SUM(amount) FROM lab_invoice_payments
 WHERE organization_id=$1 AND invoice_id=$2),0)::text AS gross,
 COALESCE((SELECT SUM(amount) FROM lab_invoice_payment_reversals
 WHERE organization_id=$1 AND invoice_id=$2),0)::text AS reversed`,
      [organizationId, invoiceId],
    )
  ).rows[0];
  const credited = (
    await db.query<{ credited: string }>(
      `SELECT COALESCE((SELECT SUM(total) FROM lab_credit_notes
 WHERE organization_id=$1 AND invoice_id=$2 AND status='ISSUED'),0)::text AS credited`,
      [organizationId, invoiceId],
    )
  ).rows[0].credited;
  return {
    gross_paid: payments.gross,
    reversed: payments.reversed,
    credited,
  };
}
async function persistInvoiceLedger(
  db: QueryRunner,
  principal: Principal,
  locked: { id: string; status: string; total: string; version: string },
) {
  const sums = await ledgerSums(db, principal.organizationId, locked.id);
  const ledger = deriveInvoiceLedger({
    billed_total: locked.total,
    ...sums,
  });
  const status =
    locked.status === 'DRAFT' || locked.status === 'CANCELLED'
      ? locked.status
      : ledger.payment_status;
  const updated = (
    await db.query<{ id: string }>(
      `UPDATE lab_invoices SET amount_paid=$3,credit_total=$4,balance_due=$5,status=$6,
 updated_by=$7,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$8
 RETURNING id`,
      [
        principal.organizationId,
        locked.id,
        ledger.net_paid,
        ledger.credited,
        ledger.balance_due,
        status,
        principal.userId,
        locked.version,
      ],
    )
  ).rows[0];
  if (!updated) stale();
  return ledger;
}
async function organizationFinance(db: QueryRunner, organizationId: string) {
  return (
    await db.query<{ currency: string; default_tax_rate: string }>(
      'SELECT currency,default_tax_rate::text FROM organizations WHERE id=$1',
      [organizationId],
    )
  ).rows[0];
}
async function allocateInvoiceNumber(db: QueryRunner, organizationId: string) {
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
    organizationId,
  ]);
  const allocated = (
    await db.query<{ year: string; last_number: string }>(
      `INSERT INTO lab_invoice_counters(organization_id,year,last_number)
 VALUES($1,EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::integer,1)
 ON CONFLICT(organization_id,year)
 DO UPDATE SET last_number=lab_invoice_counters.last_number+1
 RETURNING year::text,last_number::text`,
      [organizationId],
    )
  ).rows[0];
  return `INV-${allocated.year}-${allocated.last_number.padStart(6, '0')}`;
}
async function allocateCreditNoteNumber(db: QueryRunner, organizationId: string) {
  await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
    organizationId,
  ]);
  const allocated = (
    await db.query<{ year: string; last_number: string }>(
      `INSERT INTO lab_credit_note_counters(organization_id,year,last_number)
 VALUES($1,EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::integer,1)
 ON CONFLICT(organization_id,year)
 DO UPDATE SET last_number=lab_credit_note_counters.last_number+1
 RETURNING year::text,last_number::text`,
      [organizationId],
    )
  ).rows[0];
  return `CN-${allocated.year}-${allocated.last_number.padStart(6, '0')}`;
}
async function requireOrder(db: QueryRunner, principal: Principal, orderId: string) {
  try {
    return await getOrder(db, principal, orderId);
  } catch (error) {
    if (error instanceof OrderError && error.status === 404)
      notFound('ORDER_NOT_FOUND', 'Order');
    throw error;
  }
}

export async function getInvoiceContext(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<InvoiceContext> {
  permit(principal, 'billing:read');
  const order = await requireOrder(db, principal, orderId);
  const finance = await organizationFinance(db, principal.organizationId);
  const billable = await loadBillableLines(db, principal.organizationId, order.id);
  const preview = calculateInvoiceTotals({
    lines: billable,
    discount_type: 'NONE',
    discount_value: '0',
    tax_rate: finance.default_tax_rate,
  });
  const invoice = (
    await db.query<LabInvoice>(
      `SELECT ${invoiceSelect}
 FROM lab_invoices i
 LEFT JOIN users iss ON iss.organization_id=i.organization_id AND iss.id=i.issued_by
 LEFT JOIN users cb ON cb.organization_id=i.organization_id AND cb.id=i.cancelled_by
 WHERE i.organization_id=$1 AND i.order_id=$2 AND i.status <> 'CANCELLED'`,
      [principal.organizationId, order.id],
    )
  ).rows[0];
  const mapped = invoice ? mapInvoice(invoice) : null;
  return {
    order_id: order.id,
    order_status: order.status,
    order_number: order.order_number,
    order_version: Number(order.version),
    currency: mapped?.currency || finance.currency,
    tax_rate: mapped?.tax_rate || finance.default_tax_rate,
    billable,
    preview: {
      subtotal: preview.subtotal,
      discount_total: preview.discount_total,
      tax_total: preview.tax_total,
      total: preview.total,
    },
    invoice: mapped,
    payments: mapped
      ? await listPaymentsForInvoice(db, principal, mapped.id)
      : [],
    reversals: mapped
      ? await listReversalsForInvoice(db, principal, mapped.id)
      : [],
    credit_notes: mapped
      ? await listCreditNotesForInvoice(db, principal, mapped.id)
      : [],
  };
}

export async function createInvoice(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  input: unknown,
): Promise<LabInvoice> {
  permit(principal, 'billing:create');
  permit(principal, 'billing:read');
  const parsed = createInvoiceSchema.safeParse(input ?? {});
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{ id: string; status: string; patient_id: string }>(
        `SELECT id,status,patient_id FROM lab_orders
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(orderId, 'ORDER_NOT_FOUND', 'Order')],
      )
    ).rows[0];
    if (!locked) notFound('ORDER_NOT_FOUND', 'Order');
    if (locked.status === 'CANCELLED')
      throw new BillingError(
        409,
        'ORDER_CANCELLED',
        'Cancelled orders cannot be invoiced.',
      );
    const existing = (
      await db.query<{ id: string }>(
        `SELECT id FROM lab_invoices
 WHERE organization_id=$1 AND order_id=$2 AND status <> 'CANCELLED' FOR UPDATE`,
        [principal.organizationId, locked.id],
      )
    ).rows[0];
    if (existing)
      throw new BillingError(
        409,
        'INVOICE_EXISTS',
        'This order already has an invoice.',
      );
    const billable = await loadBillableLines(db, principal.organizationId, locked.id);
    if (billable.length === 0)
      throw new BillingError(
        409,
        'NOT_BILLABLE',
        'This order has no active tests to invoice.',
      );
    const finance = await organizationFinance(db, principal.organizationId);
    const totals = calculateInvoiceTotals({
      lines: billable,
      discount_type: 'NONE',
      discount_value: '0',
      tax_rate: finance.default_tax_rate,
    });
    const snapshot = await buildInvoiceSnapshot(db, principal, locked.id, {
      invoice_number: '',
      issued_at: '',
      issued_by_name: '',
      currency: finance.currency,
      notes: '',
      discount_type: 'NONE',
      discount_value: '0',
      tax_rate: finance.default_tax_rate,
      lines: billable,
    });
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_invoices(
 organization_id,order_id,patient_id,currency,discount_type,discount_value,tax_rate,notes,
 subtotal,discount_total,tax_total,total,amount_paid,balance_due,snapshot,created_by,updated_by)
 VALUES($1,$2,$3,$4,'NONE',0,$5,'',$6,$7,$8,$9,0,$9,$10::jsonb,$11,$11)
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          locked.patient_id,
          finance.currency,
          finance.default_tax_rate,
          totals.subtotal,
          totals.discount_total,
          totals.tax_total,
          totals.total,
          JSON.stringify(snapshot),
          principal.userId,
        ],
      )
    ).rows[0];
    await audit(db, principal, inserted.id, 'LAB_INVOICE_CREATED', {
      order_id: locked.id,
      patient_id: locked.patient_id,
      total: totals.total,
      currency: finance.currency,
    });
    return loadInvoice(db, principal, inserted.id);
  });
}

export async function getInvoice(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabInvoice> {
  permit(principal, 'billing:read');
  return loadInvoice(db, principal, idValue(id));
}

export async function listInvoicePayments(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabInvoicePayment[]> {
  permit(principal, 'billing:read');
  const invoice = await loadInvoice(db, principal, idValue(id));
  return listPaymentsForInvoice(db, principal, invoice.id);
}

export async function updateInvoice(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabInvoice> {
  permit(principal, 'billing:create');
  permit(principal, 'billing:read');
  const parsed = updateInvoiceSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        currency: string;
      }>(
        `SELECT id,status,version::text,order_id,currency FROM lab_invoices
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (locked.status !== 'DRAFT')
      throw new BillingError(
        409,
        'INVOICE_NOT_DRAFT',
        'Only draft invoices can be edited.',
      );
    const billable = await loadBillableLines(
      db,
      principal.organizationId,
      locked.order_id,
    );
    const totals = calculateInvoiceTotals({
      lines: billable,
      discount_type: parsed.data.discount_type,
      discount_value: parsed.data.discount_value,
      tax_rate: parsed.data.tax_rate,
    });
    const snapshot = await buildInvoiceSnapshot(db, principal, locked.order_id, {
      invoice_number: '',
      issued_at: '',
      issued_by_name: '',
      currency: locked.currency,
      notes: parsed.data.notes,
      discount_type: parsed.data.discount_type,
      discount_value: parsed.data.discount_value,
      tax_rate: parsed.data.tax_rate,
      due_date: parsed.data.due_date,
      lines: billable,
    });
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_invoices SET discount_type=$3,discount_value=$4,tax_rate=$5,notes=$6,due_date=$7,
 subtotal=$8,discount_total=$9,tax_total=$10,total=$11,amount_paid=0,credit_total=0,balance_due=$11,
 snapshot=$12::jsonb,updated_by=$13,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$14
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          parsed.data.discount_type,
          parsed.data.discount_value,
          parsed.data.tax_rate,
          parsed.data.notes,
          parsed.data.due_date || null,
          totals.subtotal,
          totals.discount_total,
          totals.tax_total,
          totals.total,
          JSON.stringify(snapshot),
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await audit(db, principal, locked.id, 'LAB_INVOICE_UPDATED', {
      order_id: locked.order_id,
      total: totals.total,
      currency: locked.currency,
    });
    return loadInvoice(db, principal, locked.id);
  });
}

export async function issueInvoice(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabInvoice> {
  permit(principal, 'billing:issue');
  permit(principal, 'billing:read');
  const parsed = issueInvoiceSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        patient_id: string;
        currency: string;
        discount_type: DiscountType;
        discount_value: string;
        tax_rate: string;
        notes: string;
        due_date: string;
      }>(
        `SELECT id,status,version::text,order_id,patient_id,currency,discount_type,
 discount_value::text,tax_rate::text,notes,COALESCE(due_date::text,'') AS due_date
 FROM lab_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (locked.status !== 'DRAFT')
      throw new BillingError(
        409,
        'INVOICE_NOT_DRAFT',
        'Only a draft invoice can be issued.',
      );
    const billable = await loadBillableLines(
      db,
      principal.organizationId,
      locked.order_id,
    );
    if (billable.length === 0)
      throw new BillingError(
        409,
        'NOT_BILLABLE',
        'This order has no active tests to invoice.',
      );
    const number = await allocateInvoiceNumber(db, principal.organizationId);
    const issuedAt = new Date().toISOString();
    const snapshot = await buildInvoiceSnapshot(db, principal, locked.order_id, {
      invoice_number: number,
      issued_at: issuedAt,
      issued_by_name: principal.name,
      currency: locked.currency,
      notes: locked.notes,
      discount_type: locked.discount_type,
      discount_value: locked.discount_value,
      tax_rate: locked.tax_rate,
      due_date: locked.due_date,
      lines: billable,
    });
    const frozen = invoiceFromSnapshot(snapshot);
    const ledger = deriveInvoiceLedger({
      billed_total: frozen.totals.total,
      gross_paid: '0.00',
      reversed: '0.00',
      credited: '0.00',
    });
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_invoices SET invoice_number=$3,status=$4,subtotal=$5,discount_total=$6,
 tax_total=$7,total=$8,amount_paid=0,credit_total=0,balance_due=$8,snapshot=$9::jsonb,
 issued_at=$10,issued_by=$11,updated_by=$11,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$12
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          number,
          ledger.payment_status,
          frozen.totals.subtotal,
          frozen.totals.discount_total,
          frozen.totals.tax_total,
          frozen.totals.total,
          JSON.stringify(frozen),
          issuedAt,
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await audit(db, principal, locked.id, 'LAB_INVOICE_ISSUED', {
      order_id: locked.order_id,
      patient_id: locked.patient_id,
      invoice_number: number,
      total: frozen.totals.total,
      currency: locked.currency,
    });
    return loadInvoice(db, principal, locked.id);
  });
}

export async function cancelInvoice(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabInvoice> {
  permit(principal, 'billing:cancel');
  permit(principal, 'billing:read');
  const parsed = cancelInvoiceSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        amount_paid: string;
        credit_total: string;
        invoice_number: string;
      }>(
        `SELECT id,status,version::text,order_id,amount_paid::text,credit_total::text,invoice_number
 FROM lab_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (locked.status !== 'DRAFT' && locked.status !== 'ISSUED')
      throw new BillingError(
        409,
        'INVOICE_NOT_CANCELLABLE',
        'Only unpaid draft or issued invoices can be cancelled.',
      );
    if (
      parseMoney(locked.amount_paid) !== ZERO_CENTS ||
      parseMoney(locked.credit_total) !== ZERO_CENTS
    )
      throw new BillingError(
        409,
        'INVOICE_HAS_PAYMENTS',
        'Invoices with payments or credit notes cannot be cancelled.',
      );
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_invoices SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,
 cancellation_reason=$4,updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status IN ('DRAFT','ISSUED') AND version=$5
  AND amount_paid=0 AND credit_total=0
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          principal.userId,
          parsed.data.reason,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await audit(db, principal, locked.id, 'LAB_INVOICE_CANCELLED', {
      order_id: locked.order_id,
      invoice_number: locked.invoice_number,
      reason: parsed.data.reason,
    });
    return loadInvoice(db, principal, locked.id);
  });
}

export async function recordPayment(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabInvoice> {
  permit(principal, 'billing:payment-record');
  permit(principal, 'billing:read');
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        currency: string;
        total: string;
        amount_paid: string;
        balance_due: string;
        invoice_number: string;
      }>(
        `SELECT id,status,version::text,order_id,currency,total::text,amount_paid::text,balance_due::text,
 invoice_number
 FROM lab_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (locked.status !== 'ISSUED' && locked.status !== 'PARTIALLY_PAID')
      throw new BillingError(
        409,
        'INVOICE_NOT_PAYABLE',
        'Payments can only be recorded against an issued unpaid invoice.',
      );
    const amount = parseMoney(parsed.data.amount);
    if (amount <= ZERO_CENTS)
      throw new BillingError(
        400,
        'VALIDATION',
        'Check the highlighted fields.',
        { amount: 'Payment amount must be greater than zero.' },
      );
    const balance = parseMoney(locked.balance_due);
    if (amount > balance)
      throw new BillingError(
        409,
        'PAYMENT_EXCEEDS_BALANCE',
        'Payment cannot exceed the remaining balance.',
        { amount: `Balance due is ${formatMoney(balance)} ${locked.currency}.` },
      );
    await db.query(
      `INSERT INTO lab_invoice_payments(
 organization_id,invoice_id,amount,currency,method,reference,notes,recorded_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        principal.organizationId,
        locked.id,
        parsed.data.amount,
        locked.currency,
        parsed.data.method,
        parsed.data.reference,
        parsed.data.notes,
        principal.userId,
      ],
    );
    await persistInvoiceLedger(db, principal, locked);
    await audit(db, principal, locked.id, 'LAB_PAYMENT_RECORDED', {
      order_id: locked.order_id,
      invoice_number: locked.invoice_number,
      amount: parsed.data.amount,
      currency: locked.currency,
      method: parsed.data.method,
      reference: parsed.data.reference,
    });
    return loadInvoice(db, principal, locked.id);
  });
}

export async function downloadInvoicePdf(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<{ pdf: Buffer; filename: string; invoice: LabInvoice }> {
  permit(principal, 'billing:read');
  const invoice = await loadInvoice(db, principal, idValue(id));
  if (invoice.status === 'DRAFT' || !invoice.invoice_number)
    throw new BillingError(
      409,
      'INVOICE_NOT_ISSUED',
      'Download the official PDF after the invoice is issued.',
    );
  const snapshot = invoiceFromSnapshot(invoice.snapshot as LabInvoiceSnapshot);
  const pdf = await renderInvoicePdf(snapshot);
  await audit(db, principal, invoice.id, 'LAB_INVOICE_DOWNLOADED', {
    order_id: invoice.order_id,
    invoice_number: invoice.invoice_number,
  });
  return { pdf, filename: `${invoice.invoice_number}.pdf`, invoice };
}

export async function listInvoiceWork(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<{
  invoices: InvoiceWorkItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  permit(principal, 'billing:read');
  const parsed = searchSchema.safeParse(input ?? {});
  if (!parsed.success) invalid(parsed.error);
  const { query, status, patient_id: patientId, page: requestedPage, pageSize } =
    parsed.data;
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const where = `i.organization_id=$1 AND ($2='' OR i.status=$2) AND ($3='' OR i.patient_id::text=$3)
 AND ($4='' OR i.invoice_number ILIKE $5
 OR COALESCE(i.snapshot#>>'{order,order_number}','') ILIKE $5
 OR COALESCE(i.snapshot#>>'{patient,first_name}','') ILIKE $5
 OR COALESCE(i.snapshot#>>'{patient,last_name}','') ILIKE $5
 OR (COALESCE(i.snapshot#>>'{patient,first_name}','') || ' ' ||
  COALESCE(i.snapshot#>>'{patient,last_name}','')) ILIKE $5
 OR COALESCE(i.snapshot#>>'{patient,patient_number}','') ILIKE $5)`;
  const values = [principal.organizationId, status, patientId, query, pattern];
  const total = Number(
    (
      await db.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM lab_invoices i WHERE ${where}`,
        values,
      )
    ).rows[0].total,
  );
  const page = Math.min(
    requestedPage,
    Math.max(1, Math.ceil(total / pageSize) || 1),
  );
  const invoices = (
    await db.query<InvoiceWorkItem>(
      `SELECT i.id,i.invoice_number,i.status,i.currency,i.total::text,i.amount_paid::text,
 i.credit_total::text,i.balance_due::text,COALESCE(i.due_date::text,'') AS due_date,
 COALESCE(i.issued_at::text,'') AS issued_at,i.order_id,i.patient_id,
 COALESCE(i.snapshot#>>'{order,order_number}','') AS order_number,
 COALESCE(i.snapshot#>>'{patient,patient_number}','') AS patient_number,
 COALESCE(i.snapshot#>>'{patient,first_name}','') AS patient_first_name,
 COALESCE(i.snapshot#>>'{patient,last_name}','') AS patient_last_name,
 (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.balance_due > 0
  AND i.status NOT IN ('DRAFT','CANCELLED')) AS overdue
 FROM lab_invoices i
 WHERE ${where}
 ORDER BY COALESCE(i.issued_at,i.created_at) DESC,i.id
 LIMIT $6 OFFSET $7`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows.map((row) => ({
    ...row,
    credit_total: row.credit_total || '0.00',
    due_date: row.due_date || '',
    overdue: invoiceIsOverdue({
      status: row.status,
      due_date: row.due_date || '',
      balance_due: row.balance_due,
    }),
  }));
  return { invoices, total, page, pageSize };
}

export async function getInvoiceDetail(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<{
  invoice: LabInvoice;
  payments: LabInvoicePayment[];
  reversals: LabPaymentReversal[];
  credit_notes: LabCreditNote[];
  deliveries: LabInvoiceDelivery[];
}> {
  const invoice = await getInvoice(db, principal, id);
  return {
    invoice,
    payments: await listPaymentsForInvoice(db, principal, invoice.id),
    reversals: await listReversalsForInvoice(db, principal, invoice.id),
    credit_notes: await listCreditNotesForInvoice(db, principal, invoice.id),
    deliveries: await listDeliveriesForInvoice(db, principal, invoice.id),
  };
}

export async function listInvoicesForPatient(
  db: QueryRunner,
  principal: Principal,
  patientId: string,
): Promise<InvoiceWorkItem[]> {
  permit(principal, 'billing:read');
  if (!invoiceIdSchema.safeParse(patientId).success) return [];
  return (
    await db.query<InvoiceWorkItem>(
      `SELECT i.id,i.invoice_number,i.status,i.currency,i.total::text,i.amount_paid::text,
 i.credit_total::text,i.balance_due::text,COALESCE(i.due_date::text,'') AS due_date,
 COALESCE(i.issued_at::text,'') AS issued_at,i.order_id,i.patient_id,
 COALESCE(i.snapshot#>>'{order,order_number}','') AS order_number,
 COALESCE(i.snapshot#>>'{patient,patient_number}','') AS patient_number,
 COALESCE(i.snapshot#>>'{patient,first_name}','') AS patient_first_name,
 COALESCE(i.snapshot#>>'{patient,last_name}','') AS patient_last_name,
 (i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND i.balance_due > 0
  AND i.status NOT IN ('DRAFT','CANCELLED')) AS overdue
 FROM lab_invoices i
 WHERE i.organization_id=$1 AND i.patient_id=$2
 ORDER BY COALESCE(i.issued_at,i.created_at) DESC,i.id`,
      [principal.organizationId, patientId],
    )
  ).rows.map((row) => ({
    ...row,
    credit_total: row.credit_total || '0.00',
    due_date: row.due_date || '',
    overdue: invoiceIsOverdue({
      status: row.status,
      due_date: row.due_date || '',
      balance_due: row.balance_due,
    }),
  }));
}

function assertCorrectable(status: string) {
  if (status === 'DRAFT' || status === 'CANCELLED')
    throw new BillingError(
      409,
      'INVOICE_NOT_CORRECTABLE',
      'Draft and cancelled invoices cannot receive accounting corrections.',
    );
}

async function loadCreditNote(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabCreditNote> {
  const row = (
    await db.query<LabCreditNote>(
      `SELECT ${creditNoteSelect}
 FROM lab_credit_notes c
 LEFT JOIN users iss ON iss.organization_id=c.organization_id AND iss.id=c.issued_by
 WHERE c.organization_id=$1 AND c.id=$2`,
      [principal.organizationId, id],
    )
  ).rows[0];
  return row ? mapCreditNote(row) : notFound('CREDIT_NOTE_NOT_FOUND', 'Credit note');
}

function creditNoteSnapshot(
  invoice: LabInvoice,
  input: {
    credit_note_number: string;
    issued_at: string;
    issued_by_name: string;
    reason: string;
    notes: string;
    subtotal: string;
    tax_total: string;
    total: string;
  },
): LabCreditNoteSnapshot {
  const issued = invoiceFromSnapshot(invoice.snapshot as LabInvoiceSnapshot);
  return {
    schema_version: 1,
    organization: {
      name: issued.organization.name,
      slug: issued.organization.slug,
      currency: issued.organization.currency,
    },
    patient: {
      patient_number: issued.patient.patient_number,
      first_name: issued.patient.first_name,
      last_name: issued.patient.last_name,
    },
    invoice: {
      invoice_id: invoice.id,
      invoice_number: issued.invoice.invoice_number,
      issued_at: issued.invoice.issued_at,
      billed_total: issued.totals.total,
      currency: issued.invoice.currency,
    },
    credit_note: {
      credit_note_number: input.credit_note_number,
      issued_at: input.issued_at,
      issued_by_name: input.issued_by_name,
      reason: input.reason,
      notes: input.notes,
      currency: invoice.currency,
    },
    totals: {
      subtotal: input.subtotal,
      tax_total: input.tax_total,
      total: input.total,
    },
  };
}

export async function reversePayment(
  db: QueryRunner,
  principal: Principal,
  paymentId: string,
  input: unknown,
): Promise<LabInvoice> {
  permit(principal, 'billing:correct');
  permit(principal, 'billing:read');
  const parsed = reversePaymentSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const payment = (
      await db.query<{
        id: string;
        invoice_id: string;
        amount: string;
        currency: string;
      }>(
        `SELECT id,invoice_id,amount::text,currency FROM lab_invoice_payments
 WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [
          principal.organizationId,
          idValue(paymentId, 'PAYMENT_NOT_FOUND', 'Payment'),
        ],
      )
    ).rows[0];
    if (!payment) notFound('PAYMENT_NOT_FOUND', 'Payment');
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        total: string;
        invoice_number: string;
        currency: string;
      }>(
        `SELECT id,status,version::text,order_id,total::text,invoice_number,currency
 FROM lab_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, payment.invoice_id],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    assertCorrectable(locked.status);
    const amount = parseMoney(parsed.data.amount);
    const already = parseMoney(
      (
        await db.query<{ reversed: string }>(
          `SELECT COALESCE(SUM(amount),0)::text AS reversed FROM lab_invoice_payment_reversals
 WHERE organization_id=$1 AND payment_id=$2`,
          [principal.organizationId, payment.id],
        )
      ).rows[0].reversed,
    );
    const remaining = parseMoney(payment.amount) - already;
    if (amount > remaining)
      throw new BillingError(
        409,
        'REVERSAL_EXCEEDS_PAYMENT',
        'Reversal cannot exceed the unreversed amount of this payment.',
        {
          amount: `Unreversed amount is ${formatMoney(remaining)} ${payment.currency}.`,
        },
      );
    await db.query(
      `INSERT INTO lab_invoice_payment_reversals(
 organization_id,payment_id,invoice_id,amount,currency,reason,recorded_by)
 VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        principal.organizationId,
        payment.id,
        locked.id,
        parsed.data.amount,
        payment.currency,
        parsed.data.reason,
        principal.userId,
      ],
    );
    await persistInvoiceLedger(db, principal, locked);
    await audit(db, principal, locked.id, 'LAB_PAYMENT_REVERSED', {
      order_id: locked.order_id,
      invoice_number: locked.invoice_number,
      payment_id: payment.id,
      amount: parsed.data.amount,
      currency: payment.currency,
      reason: parsed.data.reason,
    });
    return loadInvoice(db, principal, locked.id);
  });
}

export async function createCreditNote(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
  input: unknown,
): Promise<LabCreditNote> {
  permit(principal, 'billing:correct');
  permit(principal, 'billing:read');
  const parsed = createCreditNoteSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        currency: string;
        balance_due: string;
        invoice_number: string;
      }>(
        `SELECT id,status,version::text,order_id,currency,balance_due::text,invoice_number
 FROM lab_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(invoiceId)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    assertCorrectable(locked.status);
    const amount = parseMoney(parsed.data.amount);
    if (amount > parseMoney(locked.balance_due))
      throw new BillingError(
        409,
        'CREDIT_EXCEEDS_BALANCE',
        'Credit cannot exceed the remaining invoice balance.',
        {
          amount: `Balance due is ${locked.balance_due} ${locked.currency}.`,
        },
      );
    const inserted = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_credit_notes(
 organization_id,invoice_id,currency,reason,notes,subtotal,tax_total,total,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5,$6,0,$6,$7,$7)
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          locked.currency,
          parsed.data.reason,
          parsed.data.notes,
          parsed.data.amount,
          principal.userId,
        ],
      )
    ).rows[0];
    await audit(
      db,
      principal,
      inserted.id,
      'LAB_CREDIT_NOTE_CREATED',
      {
        order_id: locked.order_id,
        invoice_id: locked.id,
        invoice_number: locked.invoice_number,
        amount: parsed.data.amount,
        currency: locked.currency,
        reason: parsed.data.reason,
      },
      'LAB_CREDIT_NOTE',
    );
    return loadCreditNote(db, principal, inserted.id);
  });
}

export async function issueCreditNote(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabCreditNote> {
  permit(principal, 'billing:correct');
  permit(principal, 'billing:read');
  const parsed = issueCreditNoteSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const note = (
      await db.query<{
        id: string;
        invoice_id: string;
        status: string;
        version: string;
        reason: string;
        notes: string;
        subtotal: string;
        tax_total: string;
        total: string;
      }>(
        `SELECT id,invoice_id,status,version::text,reason,notes,subtotal::text,tax_total::text,total::text
 FROM lab_credit_notes WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [
          principal.organizationId,
          idValue(id, 'CREDIT_NOTE_NOT_FOUND', 'Credit note'),
        ],
      )
    ).rows[0];
    if (!note) notFound('CREDIT_NOTE_NOT_FOUND', 'Credit note');
    if (Number(note.version) !== parsed.data.version) stale();
    if (note.status !== 'DRAFT')
      throw new BillingError(
        409,
        'CREDIT_NOTE_NOT_DRAFT',
        'Only a draft credit note can be issued.',
      );
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        currency: string;
        total: string;
        balance_due: string;
        invoice_number: string;
      }>(
        `SELECT id,status,version::text,order_id,currency,total::text,balance_due::text,invoice_number
 FROM lab_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, note.invoice_id],
      )
    ).rows[0];
    if (!locked) notFound();
    assertCorrectable(locked.status);
    if (parseMoney(note.total) > parseMoney(locked.balance_due))
      throw new BillingError(
        409,
        'CREDIT_EXCEEDS_BALANCE',
        'Credit cannot exceed the remaining invoice balance.',
        {
          amount: `Balance due is ${locked.balance_due} ${locked.currency}.`,
        },
      );
    const invoice = await loadInvoice(db, principal, locked.id);
    const number = await allocateCreditNoteNumber(
      db,
      principal.organizationId,
    );
    const issuedAt = new Date().toISOString();
    const snapshot = creditNoteSnapshot(invoice, {
      credit_note_number: number,
      issued_at: issuedAt,
      issued_by_name: principal.name,
      reason: note.reason,
      notes: note.notes,
      subtotal: note.subtotal,
      tax_total: note.tax_total,
      total: note.total,
    });
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_credit_notes SET credit_note_number=$3,status='ISSUED',snapshot=$4::jsonb,
 issued_at=$5,issued_by=$6,updated_by=$6,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$7
 RETURNING id`,
        [
          principal.organizationId,
          note.id,
          number,
          JSON.stringify(snapshot),
          issuedAt,
          principal.userId,
          note.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
    await persistInvoiceLedger(db, principal, locked);
    await audit(
      db,
      principal,
      note.id,
      'LAB_CREDIT_NOTE_ISSUED',
      {
        order_id: locked.order_id,
        invoice_id: locked.id,
        invoice_number: locked.invoice_number,
        credit_note_number: number,
        amount: note.total,
        currency: locked.currency,
        reason: note.reason,
      },
      'LAB_CREDIT_NOTE',
    );
    return loadCreditNote(db, principal, note.id);
  });
}

export async function getCreditNote(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<LabCreditNote> {
  permit(principal, 'billing:read');
  return loadCreditNote(
    db,
    principal,
    idValue(id, 'CREDIT_NOTE_NOT_FOUND', 'Credit note'),
  );
}

export async function listInvoiceCreditNotes(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
): Promise<LabCreditNote[]> {
  permit(principal, 'billing:read');
  const invoice = await loadInvoice(db, principal, idValue(invoiceId));
  return listCreditNotesForInvoice(db, principal, invoice.id);
}

export async function listInvoiceReversals(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
): Promise<LabPaymentReversal[]> {
  permit(principal, 'billing:read');
  const invoice = await loadInvoice(db, principal, idValue(invoiceId));
  return listReversalsForInvoice(db, principal, invoice.id);
}

export async function downloadPaymentReceipt(
  db: QueryRunner,
  principal: Principal,
  paymentId: string,
): Promise<{ pdf: Buffer; filename: string }> {
  permit(principal, 'billing:read');
  const payment = (
    await db.query<LabInvoicePayment>(
      `SELECT p.id,p.organization_id,p.invoice_id,p.amount::text,p.currency,p.method,p.reference,p.notes,
 p.received_at::text,p.recorded_by,COALESCE(u.name,'') AS recorded_by_name,p.created_at::text,
 COALESCE((
  SELECT SUM(r.amount) FROM lab_invoice_payment_reversals r
  WHERE r.organization_id=p.organization_id AND r.payment_id=p.id
 ),0)::text AS reversed_amount
 FROM lab_invoice_payments p
 JOIN users u ON u.organization_id=p.organization_id AND u.id=p.recorded_by
 WHERE p.organization_id=$1 AND p.id=$2`,
      [
        principal.organizationId,
        idValue(paymentId, 'PAYMENT_NOT_FOUND', 'Payment'),
      ],
    )
  ).rows[0];
  if (!payment) notFound('PAYMENT_NOT_FOUND', 'Payment');
  const invoice = await loadInvoice(db, principal, payment.invoice_id);
  if (!invoice.invoice_number)
    throw new BillingError(
      409,
      'INVOICE_NOT_ISSUED',
      'Download a receipt after the invoice is issued.',
    );
  const reversals = (
    await db.query<LabPaymentReversal>(
      `SELECT r.id,r.organization_id,r.payment_id,r.invoice_id,r.amount::text,r.currency,r.reason,
 r.recorded_by,COALESCE(u.name,'') AS recorded_by_name,r.created_at::text
 FROM lab_invoice_payment_reversals r
 JOIN users u ON u.organization_id=r.organization_id AND u.id=r.recorded_by
 WHERE r.organization_id=$1 AND r.payment_id=$2
 ORDER BY r.created_at,r.id`,
      [principal.organizationId, payment.id],
    )
  ).rows;
  const snapshot = invoiceFromSnapshot(invoice.snapshot as LabInvoiceSnapshot);
  const pdf = await renderReceiptPdf({
    receiptId: payment.id,
    invoice: snapshot,
    payment,
    reversals,
  });
  await audit(db, principal, invoice.id, 'LAB_RECEIPT_DOWNLOADED', {
    order_id: invoice.order_id,
    invoice_number: invoice.invoice_number,
    payment_id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
  });
  return { pdf, filename: `receipt-${payment.id}.pdf` };
}

export async function emailInvoice(
  db: QueryRunner,
  principal: Principal,
  id: string,
  input: unknown,
): Promise<LabInvoice> {
  permit(principal, 'billing:email');
  permit(principal, 'billing:read');
  const parsed = emailInvoiceSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    const locked = (
      await db.query<{
        id: string;
        status: string;
        version: string;
        order_id: string;
        invoice_number: string;
      }>(
        `SELECT id,status,version::text,order_id,invoice_number
 FROM lab_invoices WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [principal.organizationId, idValue(id)],
      )
    ).rows[0];
    if (!locked) notFound();
    if (Number(locked.version) !== parsed.data.version) stale();
    if (!locked.invoice_number)
      throw new BillingError(
        409,
        'INVOICE_NOT_ISSUED',
        'Email the official PDF after the invoice is issued.',
      );
    const invoice = await loadInvoice(db, principal, locked.id);
    const snapshot = invoiceFromSnapshot(invoice.snapshot as LabInvoiceSnapshot);
    const pdf = await renderInvoicePdf(snapshot);
    const recipient = parsed.data.recipient.toLowerCase();
    let sent;
    try {
      sent = await billingEmailProvider().send({
        to: recipient,
        subject: `Invoice ${invoice.invoice_number}`,
        text: `Please find invoice ${invoice.invoice_number} attached.`,
        attachments: [
          {
            filename: `${invoice.invoice_number}.pdf`,
            contentType: 'application/pdf',
            content: pdf,
          },
        ],
      });
    } catch (error) {
      if (error instanceof BillingEmailError)
        throw new BillingError(503, error.code, error.message);
      throw new BillingError(
        503,
        'EMAIL_UNAVAILABLE',
        'Invoice email could not be sent. Try again later.',
      );
    }
    await db.query(
      `INSERT INTO lab_invoice_deliveries(organization_id,invoice_id,method,recipient,recorded_by)
 VALUES($1,$2,'EMAIL',$3,$4)`,
      [principal.organizationId, locked.id, recipient, principal.userId],
    );
    await audit(db, principal, locked.id, 'LAB_INVOICE_EMAILED', {
      order_id: locked.order_id,
      invoice_number: locked.invoice_number,
      recipient,
      provider: sent.provider,
      message_id: sent.messageId,
    });
    return loadInvoice(db, principal, locked.id);
  });
}

export async function listInvoiceDeliveries(
  db: QueryRunner,
  principal: Principal,
  invoiceId: string,
): Promise<LabInvoiceDelivery[]> {
  permit(principal, 'billing:read');
  const invoice = await loadInvoice(db, principal, idValue(invoiceId));
  return listDeliveriesForInvoice(db, principal, invoice.id);
}

export async function getBillingSettings(
  db: QueryRunner,
  principal: Principal,
): Promise<OrganizationBillingSettings> {
  permit(principal, 'billing:read');
  return organizationFinance(db, principal.organizationId);
}

export async function updateBillingSettings(
  db: QueryRunner,
  principal: Principal,
  input: unknown,
): Promise<OrganizationBillingSettings> {
  permit(principal, 'billing:settings');
  permit(principal, 'billing:read');
  const parsed = updateBillingSettingsSchema.safeParse(input);
  if (!parsed.success) invalid(parsed.error);
  return transaction(db, async () => {
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [
      principal.organizationId,
    ]);
    const updated = (
      await db.query<OrganizationBillingSettings>(
        `UPDATE organizations SET currency=$2,default_tax_rate=$3
 WHERE id=$1
 RETURNING currency,default_tax_rate::text`,
        [
          principal.organizationId,
          parsed.data.currency,
          parsed.data.default_tax_rate,
        ],
      )
    ).rows[0];
    await audit(
      db,
      principal,
      principal.organizationId,
      'BILLING_SETTINGS_UPDATED',
      {
        currency: parsed.data.currency,
        default_tax_rate: parsed.data.default_tax_rate,
      },
      'ORGANIZATION',
    );
    return updated;
  });
}

export { calculateInvoiceTotals, deriveInvoiceLedger };
