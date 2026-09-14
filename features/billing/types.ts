export type DiscountType = 'NONE' | 'PERCENT' | 'FIXED';
export type InvoiceStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';

export type InvoiceSnapshotLine = {
  order_test_id: string;
  code: string;
  name: string;
  quantity: string;
  unit_price: string;
  discount: string;
  tax: string;
  line_subtotal: string;
  line_total: string;
};

export type LabInvoiceSnapshot = {
  schema_version: 1;
  organization: {
    name: string;
    slug: string;
    type: string;
    address: string;
    phone: string;
    email: string;
    country: string;
    currency: string;
  };
  patient: {
    patient_number: string;
    first_name: string;
    last_name: string;
    address_line_1: string;
    address_line_2: string;
    city: string;
    postal_code: string;
    country: string;
  };
  order: {
    order_number: string;
    ordered_at: string;
    ordering_physician_name: string;
  };
  invoice: {
    invoice_number: string;
    issued_at: string;
    issued_by_name: string;
    currency: string;
    notes: string;
    discount_type: DiscountType;
    discount_value: string;
    tax_rate: string;
    due_date?: string;
  };
  lines: InvoiceSnapshotLine[];
  totals: {
    subtotal: string;
    discount_total: string;
    taxable: string;
    tax_total: string;
    total: string;
  };
};

export type LabInvoice = {
  id: string;
  organization_id: string;
  order_id: string;
  patient_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  currency: string;
  discount_type: DiscountType;
  discount_value: string;
  tax_rate: string;
  notes: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  amount_paid: string;
  credit_total: string;
  balance_due: string;
  due_date: string;
  overdue: boolean;
  issued_at: string;
  issued_by: string;
  issued_by_name: string;
  cancelled_at: string;
  cancelled_by: string;
  cancelled_by_name: string;
  cancellation_reason: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  version: number;
  snapshot: LabInvoiceSnapshot | Record<string, never>;
};

export type LabInvoicePayment = {
  id: string;
  organization_id: string;
  invoice_id: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
  received_at: string;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
  reversed_amount: string;
};

export type CreditNoteStatus = 'DRAFT' | 'ISSUED';

export type LabCreditNoteSnapshot = {
  schema_version: 1;
  organization: {
    name: string;
    slug: string;
    currency: string;
  };
  patient: {
    patient_number: string;
    first_name: string;
    last_name: string;
  };
  invoice: {
    invoice_id: string;
    invoice_number: string;
    issued_at: string;
    billed_total: string;
    currency: string;
  };
  credit_note: {
    credit_note_number: string;
    issued_at: string;
    issued_by_name: string;
    reason: string;
    notes: string;
    currency: string;
  };
  totals: {
    subtotal: string;
    tax_total: string;
    total: string;
  };
};

export type LabCreditNote = {
  id: string;
  organization_id: string;
  invoice_id: string;
  credit_note_number: string;
  status: CreditNoteStatus;
  currency: string;
  reason: string;
  notes: string;
  subtotal: string;
  tax_total: string;
  total: string;
  issued_at: string;
  issued_by: string;
  issued_by_name: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  version: number;
  snapshot: LabCreditNoteSnapshot | Record<string, never>;
};

export type LabPaymentReversal = {
  id: string;
  organization_id: string;
  payment_id: string;
  invoice_id: string;
  amount: string;
  currency: string;
  reason: string;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
};

export type LabInvoiceDelivery = {
  id: string;
  organization_id: string;
  invoice_id: string;
  method: 'EMAIL';
  recipient: string;
  recorded_by: string;
  recorded_by_name: string;
  occurred_at: string;
};

export type OrganizationBillingSettings = {
  currency: string;
  default_tax_rate: string;
};

export type BillableLine = {
  order_test_id: string;
  code: string;
  name: string;
  quantity: string;
  unit_price: string;
};

export type InvoiceContext = {
  order_id: string;
  order_status: string;
  order_number: string;
  order_version: number;
  currency: string;
  tax_rate: string;
  billable: BillableLine[];
  preview: {
    subtotal: string;
    discount_total: string;
    tax_total: string;
    total: string;
  };
  invoice: LabInvoice | null;
  payments: LabInvoicePayment[];
  reversals: LabPaymentReversal[];
  credit_notes: LabCreditNote[];
};

export type InvoiceWorkItem = {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  currency: string;
  total: string;
  amount_paid: string;
  credit_total: string;
  balance_due: string;
  due_date: string;
  overdue: boolean;
  issued_at: string;
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_number: string;
  patient_first_name: string;
  patient_last_name: string;
};

export class BillingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
