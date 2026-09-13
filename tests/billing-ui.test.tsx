import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceList } from '../components/billing/list';
import { InvoiceDetail } from '../components/billing/detail';
import { OrderDetail } from '../components/orders/detail';
import { PatientDetail } from '../components/patients/detail';
import { emptyPatient } from '../features/patients/validation';
import type { LabInvoice } from '../features/billing/types';
import type { LabOrder } from '../features/orders/types';
import type { Patient } from '../features/patients/types';
const order: LabOrder = {
  id: '00000000-0000-4000-8000-000000000010',
  organization_id: 'org',
  patient_id: '00000000-0000-4000-8000-000000000011',
  order_number: 'LAB-2026-000009',
  status: 'RECEIVED',
  priority: 'ROUTINE',
  ordered_at: '2026-09-11T10:00:00.000Z',
  ordered_by: 'user',
  ordered_by_name: 'Tech',
  ordering_physician_name: '',
  clinical_notes: '',
  fasting_status: 'FASTING',
  external_reference: '',
  cancellation_reason: '',
  cancelled_at: '',
  cancelled_by: '',
  cancelled_by_name: '',
  version: 3,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-09-11T10:00:00.000Z',
  updated_at: '2026-09-11T10:00:00.000Z',
  patient_number: 'PAT-000005',
  patient_first_name: 'John',
  patient_last_name: 'Test',
  patient_status: 'ACTIVE',
  tests: [],
  specimens: [],
  results: [],
  reports: [],
  test_count: 1,
  covered_count: 1,
  received_count: 1,
};
const invoice: LabInvoice = {
  id: '00000000-0000-4000-8000-000000000030',
  organization_id: 'org',
  order_id: order.id,
  patient_id: order.patient_id,
  invoice_number: 'INV-2026-000001',
  status: 'PARTIALLY_PAID',
  currency: 'ALL',
  discount_type: 'NONE',
  discount_value: '0.00',
  tax_rate: '0.00',
  notes: '',
  subtotal: '15.00',
  discount_total: '0.00',
  tax_total: '0.00',
  total: '15.00',
  amount_paid: '5.00',
  balance_due: '10.00',
  issued_at: '2026-09-13T10:00:00.000Z',
  issued_by: 'user',
  issued_by_name: 'Reception',
  cancelled_at: '',
  cancelled_by: '',
  cancelled_by_name: '',
  cancellation_reason: '',
  created_at: '2026-09-13T09:00:00.000Z',
  updated_at: '2026-09-13T10:05:00.000Z',
  created_by: 'user',
  updated_by: 'user',
  version: 3,
  snapshot: {
    schema_version: 1,
    organization: {
      name: 'Development Laboratory',
      slug: 'a',
      type: 'CLINIC',
      address: '1 Lab Street',
      phone: '',
      email: '',
      country: 'AL',
      currency: 'ALL',
    },
    patient: {
      patient_number: 'PAT-000005',
      first_name: 'John',
      last_name: 'Test',
      address_line_1: '',
      address_line_2: '',
      city: '',
      postal_code: '',
      country: 'AL',
    },
    order: {
      order_number: 'LAB-2026-000009',
      ordered_at: '2026-09-11T10:00:00.000Z',
      ordering_physician_name: '',
    },
    invoice: {
      invoice_number: 'INV-2026-000001',
      issued_at: '2026-09-13T10:00:00.000Z',
      issued_by_name: 'Reception',
      currency: 'ALL',
      notes: '',
      discount_type: 'NONE',
      discount_value: '0.00',
      tax_rate: '0.00',
    },
    lines: [
      {
        order_test_id: 'line-1',
        code: 'GLU',
        name: 'Glucose',
        quantity: '1.00',
        unit_price: '8.00',
        discount: '0.00',
        tax: '0.00',
        line_subtotal: '8.00',
        line_total: '8.00',
      },
    ],
    totals: {
      subtotal: '15.00',
      discount_total: '0.00',
      taxable: '15.00',
      tax_total: '0.00',
      total: '15.00',
    },
  },
};
void test('billing worklist searches invoices and labels snapshot identity', () => {
  const html = renderToStaticMarkup(
    <InvoiceList
      initial={{
        invoices: [
          {
            id: invoice.id,
            invoice_number: invoice.invoice_number,
            status: invoice.status,
            currency: invoice.currency,
            total: invoice.total,
            amount_paid: invoice.amount_paid,
            balance_due: invoice.balance_due,
            issued_at: invoice.issued_at,
            order_id: invoice.order_id,
            order_number: 'LAB-2026-000009',
            patient_id: invoice.patient_id,
            patient_number: 'PAT-000005',
            patient_first_name: 'John',
            patient_last_name: 'Test',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }}
    />,
  );
  for (const text of [
    'Laboratory billing',
    'Search invoices',
    'INV-2026-000001',
    'John Test',
    'LAB-2026-000009',
    'Partially paid',
    'ALL 15.00',
    'ALL 5.00',
    'ALL 10.00',
    'frozen snapshot',
    'Previous',
    'Next',
  ])
    assert.ok(html.includes(text), text);
});
void test('invoice detail keeps billed snapshot values and current ledger separate', () => {
  const html = renderToStaticMarkup(
    <InvoiceDetail
      initial={invoice}
      payments={[
        {
          id: '00000000-0000-4000-8000-000000000031',
          organization_id: 'org',
          invoice_id: invoice.id,
          amount: '5.00',
          currency: 'ALL',
          method: 'CASH',
          reference: 'desk',
          notes: '',
          received_at: '2026-09-13T10:05:00.000Z',
          recorded_by: 'user',
          recorded_by_name: 'Reception',
          created_at: '2026-09-13T10:05:00.000Z',
        },
      ]}
      canIssue
      canPay
      canCancel={false}
      canEditDraft={false}
    />,
  );
  assert.ok(html.includes('INV-2026-000001'));
  assert.ok(html.includes('Glucose'));
  assert.ok(html.includes('Current account state'));
  assert.ok(html.includes('does not rewrite the issued'));
  assert.ok(html.includes('Record payment'));
  assert.ok(html.includes('Download invoice PDF'));
  assert.ok(html.includes('/api/lab-invoices/00000000-0000-4000-8000-000000000030/pdf'));
  const readonly = renderToStaticMarkup(
    <InvoiceDetail
      initial={invoice}
      payments={[]}
      canIssue={false}
      canPay={false}
      canCancel={false}
      canEditDraft={false}
    />,
  );
  assert.ok(!readonly.includes('Record payment'));
  assert.ok(!readonly.includes('Issue invoice'));
});
void test('order billing panel and patient billing tab follow permissions', () => {
  const html = renderToStaticMarkup(
    <OrderDetail
      initial={order}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect={false}
      canReceive={false}
      canReject={false}
      canReadBilling
      canCreateBilling
      canIssueBilling
      canRecordPayments
    />,
  );
  assert.ok(html.includes('Billing'));
  assert.ok(html.includes('Financial status is independent of clinical results'));
  const hidden = renderToStaticMarkup(
    <OrderDetail
      initial={order}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect={false}
      canReceive={false}
      canReject={false}
    />,
  );
  assert.ok(!hidden.includes('Financial status is independent of clinical results'));
  const patient: Patient = {
    ...emptyPatient,
    first_name: 'John',
    last_name: 'Test',
    id: order.patient_id,
    organization_id: 'org',
    patient_number: 'PAT-000005',
    version: 1,
    created_at: '2026-09-11',
    updated_at: '2026-09-11',
    created_by: 'user',
    updated_by: 'user',
  };
  const billed = renderToStaticMarkup(
    <PatientDetail patient={patient} canActivity={false} canReadBilling />,
  );
  assert.ok(billed.includes('Invoice names come from each issued snapshot'));
  const denied = renderToStaticMarkup(
    <PatientDetail patient={patient} canActivity={false} />,
  );
  assert.ok(denied.includes('Your role cannot view invoices for this patient.'));
});
