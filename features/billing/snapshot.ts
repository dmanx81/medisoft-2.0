import type { QueryRunner } from '@/lib/db/query';
import type { Principal } from '@/lib/auth/permissions';
import { calculateInvoiceTotals, type DiscountType } from './money';
import type {
  BillableLine,
  LabInvoiceSnapshot,
} from './types';

export function invoiceFromSnapshot(
  snapshot: LabInvoiceSnapshot,
): LabInvoiceSnapshot {
  if (snapshot.schema_version !== 1)
    throw new Error('Unsupported invoice snapshot version.');
  if (!snapshot.invoice?.invoice_number || !snapshot.totals?.total)
    throw new Error('Issued invoice snapshot is missing frozen identity.');
  return snapshot;
}

export async function loadBillableLines(
  db: QueryRunner,
  organizationId: string,
  orderId: string,
): Promise<BillableLine[]> {
  return (
    await db.query<BillableLine>(
      `SELECT id AS order_test_id,code_snapshot AS code,name_snapshot AS name,'1.00' AS quantity,
 COALESCE(base_price_snapshot::text,'0.00') AS unit_price
 FROM lab_order_tests
 WHERE organization_id=$1 AND order_id=$2 AND status='ACTIVE'
 ORDER BY created_at,id`,
      [organizationId, orderId],
    )
  ).rows;
}

export async function buildInvoiceSnapshot(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
  input: {
    invoice_number: string;
    issued_at: string;
    issued_by_name: string;
    currency: string;
    notes: string;
    discount_type: DiscountType;
    discount_value: string;
    tax_rate: string;
    due_date?: string;
    lines: BillableLine[];
  },
): Promise<LabInvoiceSnapshot> {
  const organization = (
    await db.query<{
      name: string;
      slug: string;
      type: string;
      address: string;
      phone: string;
      email: string;
      country: string;
      currency: string;
    }>(
      `SELECT name,slug,type,COALESCE(address,'') AS address,COALESCE(phone,'') AS phone,
 COALESCE(email,'') AS email,country,currency FROM organizations WHERE id=$1`,
      [principal.organizationId],
    )
  ).rows[0];
  const order = (
    await db.query<{
      order_number: string;
      ordered_at: string;
      ordering_physician_name: string;
      patient_number: string;
      first_name: string;
      last_name: string;
      address_line_1: string;
      address_line_2: string;
      city: string;
      postal_code: string;
      country: string;
    }>(
      `SELECT o.order_number,COALESCE(o.ordered_at::text,'') AS ordered_at,o.ordering_physician_name,
 p.patient_number,p.first_name,p.last_name,COALESCE(p.address_line_1,'') AS address_line_1,
 COALESCE(p.address_line_2,'') AS address_line_2,COALESCE(p.city,'') AS city,
 COALESCE(p.postal_code,'') AS postal_code,COALESCE(p.country,'') AS country
 FROM lab_orders o
 JOIN patients p ON p.organization_id=o.organization_id AND p.id=o.patient_id
 WHERE o.organization_id=$1 AND o.id=$2`,
      [principal.organizationId, orderId],
    )
  ).rows[0];
  const totals = calculateInvoiceTotals({
    lines: input.lines,
    discount_type: input.discount_type,
    discount_value: input.discount_value,
    tax_rate: input.tax_rate,
  });
  return {
    schema_version: 1,
    organization: {
      name: organization.name,
      slug: organization.slug,
      type: organization.type,
      address: organization.address,
      phone: organization.phone,
      email: organization.email,
      country: organization.country,
      currency: input.currency || organization.currency,
    },
    patient: {
      patient_number: order.patient_number,
      first_name: order.first_name,
      last_name: order.last_name,
      address_line_1: order.address_line_1,
      address_line_2: order.address_line_2,
      city: order.city,
      postal_code: order.postal_code,
      country: order.country,
    },
    order: {
      order_number: order.order_number,
      ordered_at: order.ordered_at,
      ordering_physician_name: order.ordering_physician_name,
    },
    invoice: {
      invoice_number: input.invoice_number,
      issued_at: input.issued_at,
      issued_by_name: input.issued_by_name,
      currency: input.currency,
      notes: input.notes,
      discount_type: input.discount_type,
      discount_value: input.discount_value,
      tax_rate: input.tax_rate,
      ...(input.due_date ? { due_date: input.due_date } : {}),
    },
    lines: totals.lines,
    totals: {
      subtotal: totals.subtotal,
      discount_total: totals.discount_total,
      taxable: totals.taxable,
      tax_total: totals.tax_total,
      total: totals.total,
    },
  };
}
