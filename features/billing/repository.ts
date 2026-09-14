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
import { renderInvoicePdf } from './pdf';
import { buildInvoiceSnapshot, invoiceFromSnapshot, loadBillableLines } from './snapshot';
import {
  cancelInvoiceSchema,
  createInvoiceSchema,
  fieldErrors,
  invoiceIdSchema,
  issueInvoiceSchema,
  recordPaymentSchema,
  searchSchema,
  updateInvoiceSchema,
} from './validation';
import {
  BillingError,
  type InvoiceContext,
  type InvoiceWorkItem,
  type LabInvoice,
  type LabInvoicePayment,
  type LabInvoiceSnapshot,
} from './types';

export const invoiceSelect = `i.id,i.organization_id,i.order_id,i.patient_id,i.invoice_number,i.status,
 i.currency,i.discount_type,i.discount_value::text,i.tax_rate::text,i.notes,i.subtotal::text,
 i.discount_total::text,i.tax_total::text,i.total::text,i.amount_paid::text,i.balance_due::text,
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
  return {
    ...row,
    version: Number(row.version),
    snapshot: parseSnapshot(row.snapshot),
  };
}
function mapPayment(row: LabInvoicePayment): LabInvoicePayment {
  return row;
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
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,'LAB_INVOICE',$4,$5::jsonb,$6)`,
    [
      principal.organizationId,
      principal.userId,
      action,
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
 p.received_at::text,p.recorded_by,COALESCE(u.name,'') AS recorded_by_name,p.created_at::text
 FROM lab_invoice_payments p
 JOIN users u ON u.organization_id=p.organization_id AND u.id=p.recorded_by
 WHERE p.organization_id=$1 AND p.invoice_id=$2
 ORDER BY p.received_at,p.id`,
      [principal.organizationId, invoiceId],
    )
  ).rows.map(mapPayment);
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
function paymentStatus(total: string, paid: string) {
  if (parseMoney(paid) === parseMoney(total)) return 'PAID';
  if (parseMoney(paid) === ZERO_CENTS) return 'ISSUED';
  return 'PARTIALLY_PAID';
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
      lines: billable,
    });
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_invoices SET discount_type=$3,discount_value=$4,tax_rate=$5,notes=$6,
 subtotal=$7,discount_total=$8,tax_total=$9,total=$10,amount_paid=0,balance_due=$10,
 snapshot=$11::jsonb,updated_by=$12,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$13
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          parsed.data.discount_type,
          parsed.data.discount_value,
          parsed.data.tax_rate,
          parsed.data.notes,
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
      }>(
        `SELECT id,status,version::text,order_id,patient_id,currency,discount_type,
 discount_value::text,tax_rate::text,notes
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
      lines: billable,
    });
    const frozen = invoiceFromSnapshot(snapshot);
    const status = paymentStatus(frozen.totals.total, '0.00');
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_invoices SET invoice_number=$3,status=$4,subtotal=$5,discount_total=$6,
 tax_total=$7,total=$8,amount_paid=0,balance_due=$8,snapshot=$9::jsonb,issued_at=$10,issued_by=$11,
 updated_by=$11,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='DRAFT' AND version=$12
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          number,
          status,
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
        invoice_number: string;
      }>(
        `SELECT id,status,version::text,order_id,amount_paid::text,invoice_number
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
    if (parseMoney(locked.amount_paid) !== ZERO_CENTS)
      throw new BillingError(
        409,
        'INVOICE_HAS_PAYMENTS',
        'Invoices with payments cannot be cancelled.',
      );
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_invoices SET status='CANCELLED',cancelled_at=now(),cancelled_by=$3,
 cancellation_reason=$4,updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status IN ('DRAFT','ISSUED') AND version=$5
  AND amount_paid=0
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
    const paid = parseMoney(locked.amount_paid) + amount;
    const due = parseMoney(locked.total) - paid;
    const status = paymentStatus(locked.total, formatMoney(paid));
    const updated = (
      await db.query<{ id: string }>(
        `UPDATE lab_invoices SET amount_paid=$3,balance_due=$4,status=$5,updated_by=$6,version=version+1
 WHERE organization_id=$1 AND id=$2 AND version=$7 AND status IN ('ISSUED','PARTIALLY_PAID')
 RETURNING id`,
        [
          principal.organizationId,
          locked.id,
          formatMoney(paid),
          formatMoney(due),
          status,
          principal.userId,
          locked.version,
        ],
      )
    ).rows[0];
    if (!updated) stale();
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
 i.balance_due::text,COALESCE(i.issued_at::text,'') AS issued_at,i.order_id,i.patient_id,
 COALESCE(i.snapshot#>>'{order,order_number}','') AS order_number,
 COALESCE(i.snapshot#>>'{patient,patient_number}','') AS patient_number,
 COALESCE(i.snapshot#>>'{patient,first_name}','') AS patient_first_name,
 COALESCE(i.snapshot#>>'{patient,last_name}','') AS patient_last_name
 FROM lab_invoices i
 WHERE ${where}
 ORDER BY COALESCE(i.issued_at,i.created_at) DESC,i.id
 LIMIT $6 OFFSET $7`,
      [...values, pageSize, (page - 1) * pageSize],
    )
  ).rows;
  return { invoices, total, page, pageSize };
}

export async function getInvoiceDetail(
  db: QueryRunner,
  principal: Principal,
  id: string,
): Promise<{ invoice: LabInvoice; payments: LabInvoicePayment[] }> {
  const invoice = await getInvoice(db, principal, id);
  return {
    invoice,
    payments: await listPaymentsForInvoice(db, principal, invoice.id),
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
 i.balance_due::text,COALESCE(i.issued_at::text,'') AS issued_at,i.order_id,i.patient_id,
 COALESCE(i.snapshot#>>'{order,order_number}','') AS order_number,
 COALESCE(i.snapshot#>>'{patient,patient_number}','') AS patient_number,
 COALESCE(i.snapshot#>>'{patient,first_name}','') AS patient_first_name,
 COALESCE(i.snapshot#>>'{patient,last_name}','') AS patient_last_name
 FROM lab_invoices i
 WHERE i.organization_id=$1 AND i.patient_id=$2
 ORDER BY COALESCE(i.issued_at,i.created_at) DESC,i.id`,
      [principal.organizationId, patientId],
    )
  ).rows;
}

export { calculateInvoiceTotals };
