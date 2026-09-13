'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type {
  LabInvoice,
  LabInvoicePayment,
  LabInvoiceSnapshot,
} from '@/features/billing/types';
import {
  discountTypeLabels,
  invoiceStatusLabels,
  moneyLabel,
  paymentMethodLabels,
} from '@/features/billing/format';
import { stampLabel } from '@/features/orders/format';
import { parseMoney } from '@/features/billing/money';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
function snapshotOf(invoice: LabInvoice): LabInvoiceSnapshot | null {
  const snapshot = invoice.snapshot as LabInvoiceSnapshot;
  return snapshot?.schema_version === 1 ? snapshot : null;
}
export function InvoiceDetail({
  initial,
  payments: initialPayments,
  canIssue,
  canPay,
  canCancel,
  canEditDraft,
}: {
  initial: LabInvoice;
  payments: LabInvoicePayment[];
  canIssue: boolean;
  canPay: boolean;
  canCancel: boolean;
  canEditDraft: boolean;
}) {
  const [invoice, setInvoice] = useState(initial);
  const [payments, setPayments] = useState(initialPayments);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [discountType, setDiscountType] = useState(invoice.discount_type);
  const [discountValue, setDiscountValue] = useState(invoice.discount_value);
  const [taxRate, setTaxRate] = useState(invoice.tax_rate);
  const [notes, setNotes] = useState(invoice.notes);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const snapshot = snapshotOf(invoice);
  const issued = invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED';
  const payable =
    invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID';
  const cancellable =
    (invoice.status === 'DRAFT' || invoice.status === 'ISSUED') &&
    parseMoney(invoice.amount_paid) === 0n;
  async function send(path: string, methodName: string, body: unknown) {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(path, {
        method: methodName,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      const payload = (await response.json()) as Failure & LabInvoice;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      setInvoice(payload);
      setDiscountType(payload.discount_type);
      setDiscountValue(payload.discount_value);
      setTaxRate(payload.tax_rate);
      setNotes(payload.notes);
      if (path.includes('/payments') || methodName === 'POST') {
        const listed = await fetch(`/api/lab-invoices/${payload.id}/payments`, {
          cache: 'no-store',
        });
        if (listed.ok) setPayments((await listed.json()) as LabInvoicePayment[]);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/app/billing" className="text-sm text-teal">
        ← Billing
      </Link>
      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold font-mono">
            {invoice.invoice_number || 'Draft invoice'}
          </h1>
          <p className="mt-2 text-sm text-slate">
            {invoiceStatusLabels[invoice.status]} ·{' '}
            {moneyLabel(invoice.total, invoice.currency)} billed ·{' '}
            {moneyLabel(invoice.amount_paid, invoice.currency)} paid ·{' '}
            {moneyLabel(invoice.balance_due, invoice.currency)} due
          </p>
        </div>
        {invoice.invoice_number && invoice.status !== 'DRAFT' && (
          <a
            className="rounded-md bg-teal px-4 py-2 text-sm text-white"
            href={`/api/lab-invoices/${invoice.id}/pdf`}
          >
            Download invoice PDF
          </a>
        )}
      </header>
      {failure && (
        <p className="mb-4 rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {failure.message || 'The billing action could not be completed.'}
        </p>
      )}
      <section className="mb-4 rounded-md border border-line bg-white p-5">
        <h2 className="mb-3 font-semibold">Customer and order</h2>
        <p className="text-sm">
          {(snapshot?.patient.last_name || '') +
            (snapshot?.patient.first_name
              ? `, ${snapshot.patient.first_name}`
              : '')}{' '}
          <span className="font-mono text-xs text-slate">
            {snapshot?.patient.patient_number}
          </span>
        </p>
        <p className="mt-1 text-sm text-slate">
          Order{' '}
          <Link
            className="font-mono text-teal"
            href={`/app/laboratory/orders/${invoice.order_id}`}
          >
            {snapshot?.order.order_number || invoice.order_id}
          </Link>
          {snapshot?.invoice.issued_at
            ? ` · Issued ${stampLabel(snapshot.invoice.issued_at)} by ${snapshot.invoice.issued_by_name}`
            : ''}
        </p>
        {invoice.status !== 'DRAFT' && (
          <p className="mt-3 text-sm text-slate">
            Official billed identity is frozen. Later patient or catalogue
            changes do not rewrite this invoice.
          </p>
        )}
      </section>
      <section className="mb-4 rounded-md border border-line bg-white p-5">
        <h2 className="mb-3 font-semibold">Billed items</h2>
        <ul className="grid gap-2 text-sm">
          {(snapshot?.lines ?? []).map((line) => (
            <li key={line.order_test_id} className="flex justify-between gap-3">
              <span>
                <span className="font-mono">{line.code}</span> {line.name}
              </span>
              <span>
                {line.quantity} × {moneyLabel(line.unit_price, invoice.currency)}{' '}
                = {moneyLabel(line.line_total, invoice.currency)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate">Subtotal</dt>
            <dd>{moneyLabel(invoice.subtotal, invoice.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate">
              Discount ({discountTypeLabels[invoice.discount_type]})
            </dt>
            <dd>{moneyLabel(invoice.discount_total, invoice.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate">Tax ({invoice.tax_rate}%)</dt>
            <dd>{moneyLabel(invoice.tax_total, invoice.currency)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Total billed</dt>
            <dd>{moneyLabel(invoice.total, invoice.currency)}</dd>
          </div>
        </dl>
      </section>
      {canEditDraft && invoice.status === 'DRAFT' && (
        <form
          className="mb-4 grid gap-3 rounded-md border border-line bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send(`/api/lab-invoices/${invoice.id}`, 'PATCH', {
              discount_type: discountType,
              discount_value: discountType === 'NONE' ? '0' : discountValue,
              tax_rate: taxRate,
              notes,
              version: invoice.version,
            });
          }}
        >
          <h2 className="font-semibold">Draft financial values</h2>
          <label className="text-sm font-medium">
            Discount
            <NativeSelect
              className="mt-2 h-9"
              value={discountType}
              onChange={(event) =>
                setDiscountType(
                  event.target.value as LabInvoice['discount_type'],
                )
              }
            >
              {Object.entries(discountTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          {discountType !== 'NONE' && (
            <label className="text-sm font-medium">
              Discount value
              <Input
                className="mt-2"
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
              />
            </label>
          )}
          <label className="text-sm font-medium">
            Tax rate (%)
            <Input
              className="mt-2"
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Invoice note
            <Input
              className="mt-2"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
          >
            Save draft
          </button>
        </form>
      )}
      {canIssue && invoice.status === 'DRAFT' && (
        <button
          type="button"
          disabled={busy}
          className="mb-4 rounded-md bg-teal px-4 py-2 text-sm text-white"
          onClick={() =>
            void send(`/api/lab-invoices/${invoice.id}/issue`, 'POST', {
              version: invoice.version,
            })
          }
        >
          Issue invoice
        </button>
      )}
      <section className="mb-4 rounded-md border border-line bg-white p-5">
        <h2 className="mb-2 font-semibold">Current account state</h2>
        <p className="mb-3 text-sm text-slate">
          Payment status is the current ledger. It does not rewrite the issued
          invoice totals above.
        </p>
        <p className="text-sm">
          Paid {moneyLabel(invoice.amount_paid, invoice.currency)} · Balance{' '}
          {moneyLabel(invoice.balance_due, invoice.currency)}
        </p>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No payments recorded.</p>
        ) : (
          <ul className="mt-3 grid gap-2 text-sm">
            {payments.map((payment) => (
              <li key={payment.id} className="rounded-md border border-line p-3">
                <p>
                  {moneyLabel(payment.amount, payment.currency)} ·{' '}
                  {paymentMethodLabels[payment.method]}
                </p>
                <p className="text-xs text-slate">
                  {stampLabel(payment.received_at)} by {payment.recorded_by_name}
                  {payment.reference ? ` · ${payment.reference}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canPay && payable && (
          <form
            className="mt-4 grid gap-3 rounded-md bg-mint p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send(`/api/lab-invoices/${invoice.id}/payments`, 'POST', {
                amount,
                method,
                reference,
                notes: paymentNotes,
                version: invoice.version,
              });
            }}
          >
            <h3 className="font-medium">Record payment</h3>
            <label className="text-sm font-medium">
              Amount
              <Input
                className="mt-2"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="text-sm font-medium">
              Method
              <NativeSelect
                className="mt-2 h-9"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                {Object.entries(paymentMethodLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="text-sm font-medium">
              Reference
              <Input
                className="mt-2"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Notes
              <Input
                className="mt-2"
                value={paymentNotes}
                onChange={(event) => setPaymentNotes(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
            >
              Save payment
            </button>
          </form>
        )}
      </section>
      {canCancel && cancellable && (
        <form
          className="mb-4 flex flex-wrap gap-2 rounded-md border border-line bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send(`/api/lab-invoices/${invoice.id}/cancel`, 'POST', {
              reason: cancelReason,
              version: invoice.version,
            });
          }}
        >
          <Input
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Cancellation reason"
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-coral px-4 py-2 text-sm text-coral"
          >
            Cancel invoice
          </button>
        </form>
      )}
      {invoice.status === 'CANCELLED' && (
        <p className="text-sm text-coral">
          Cancelled {stampLabel(invoice.cancelled_at)} by{' '}
          {invoice.cancelled_by_name}: {invoice.cancellation_reason}
        </p>
      )}
      {issued && invoice.notes && (
        <p className="mt-4 text-sm text-slate">Note: {invoice.notes}</p>
      )}
    </div>
  );
}
