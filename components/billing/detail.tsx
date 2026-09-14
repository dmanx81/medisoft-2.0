'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type {
  LabCreditNote,
  LabInvoice,
  LabInvoiceDelivery,
  LabInvoicePayment,
  LabInvoiceSnapshot,
  LabPaymentReversal,
} from '@/features/billing/types';
import {
  creditNoteStatusLabels,
  discountTypeLabels,
  invoiceStatusLabels,
  moneyLabel,
  paymentMethodLabels,
} from '@/features/billing/format';
import { stampLabel } from '@/features/orders/format';
import { formatMoney, parseMoney, ZERO_CENTS } from '@/features/billing/money';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
function snapshotOf(invoice: LabInvoice): LabInvoiceSnapshot | null {
  const snapshot = invoice.snapshot as LabInvoiceSnapshot;
  return snapshot?.schema_version === 1 ? snapshot : null;
}
function remainingPayment(payment: LabInvoicePayment) {
  return formatMoney(
    parseMoney(payment.amount) - parseMoney(payment.reversed_amount || '0.00'),
  );
}
export function InvoiceDetail({
  initial,
  payments: initialPayments,
  reversals: initialReversals = [],
  creditNotes: initialCreditNotes = [],
  deliveries: initialDeliveries = [],
  canIssue,
  canPay,
  canCancel,
  canEditDraft,
  canCorrect = false,
  canEmail = false,
}: {
  initial: LabInvoice;
  payments: LabInvoicePayment[];
  reversals?: LabPaymentReversal[];
  creditNotes?: LabCreditNote[];
  deliveries?: LabInvoiceDelivery[];
  canIssue: boolean;
  canPay: boolean;
  canCancel: boolean;
  canEditDraft: boolean;
  canCorrect?: boolean;
  canEmail?: boolean;
}) {
  const [invoice, setInvoice] = useState(initial);
  const [payments, setPayments] = useState(initialPayments);
  const [reversals, setReversals] = useState(initialReversals);
  const [creditNotes, setCreditNotes] = useState(initialCreditNotes);
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [discountType, setDiscountType] = useState(invoice.discount_type);
  const [discountValue, setDiscountValue] = useState(invoice.discount_value);
  const [taxRate, setTaxRate] = useState(invoice.tax_rate);
  const [notes, setNotes] = useState(invoice.notes);
  const [dueDate, setDueDate] = useState(invoice.due_date || '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [reversalAmount, setReversalAmount] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [reversalPaymentId, setReversalPaymentId] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [emailRecipient, setEmailRecipient] = useState('');
  const snapshot = snapshotOf(invoice);
  const issued = invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED';
  const payable =
    invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID';
  const cancellable =
    (invoice.status === 'DRAFT' || invoice.status === 'ISSUED') &&
    parseMoney(invoice.amount_paid) === ZERO_CENTS &&
    parseMoney(invoice.credit_total || '0.00') === ZERO_CENTS;
  const officialDue = snapshot?.invoice.due_date || invoice.due_date;
  async function refresh(invoiceId: string) {
    const [
      invoiceResponse,
      paymentsResponse,
      notesResponse,
      deliveryResponse,
      reversalResponse,
    ] = await Promise.all([
      fetch(`/api/lab-invoices/${invoiceId}`, { cache: 'no-store' }),
      fetch(`/api/lab-invoices/${invoiceId}/payments`, { cache: 'no-store' }),
      fetch(`/api/lab-invoices/${invoiceId}/credit-notes`, { cache: 'no-store' }),
      fetch(`/api/lab-invoices/${invoiceId}/deliveries`, { cache: 'no-store' }),
      fetch(`/api/lab-invoices/${invoiceId}/reversals`, { cache: 'no-store' }),
    ]);
    if (invoiceResponse.ok) {
      const payload = (await invoiceResponse.json()) as LabInvoice;
      setInvoice(payload);
      setDiscountType(payload.discount_type);
      setDiscountValue(payload.discount_value);
      setTaxRate(payload.tax_rate);
      setNotes(payload.notes);
      setDueDate(payload.due_date || '');
    }
    if (paymentsResponse.ok)
      setPayments((await paymentsResponse.json()) as LabInvoicePayment[]);
    if (notesResponse.ok)
      setCreditNotes((await notesResponse.json()) as LabCreditNote[]);
    if (deliveryResponse.ok)
      setDeliveries((await deliveryResponse.json()) as LabInvoiceDelivery[]);
    if (reversalResponse.ok)
      setReversals((await reversalResponse.json()) as LabPaymentReversal[]);
  }
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
      const payload = (await response.json()) as Failure &
        LabInvoice &
        LabCreditNote;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      await refresh(payload.invoice_id || payload.id || invoice.id);
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
            {invoiceStatusLabels[invoice.status]} · Official billed{' '}
            {moneyLabel(invoice.total, invoice.currency)} · Remaining{' '}
            {moneyLabel(invoice.balance_due, invoice.currency)}
            {invoice.overdue ? ' · Overdue' : ''}
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
        <h2 className="mb-3 font-semibold">Official billed document</h2>
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
        {officialDue && (
          <p className="mt-1 text-sm text-slate">
            Due {officialDue}
            {invoice.overdue ? ' · Overdue on the current ledger' : ''}
          </p>
        )}
        {invoice.status !== 'DRAFT' && (
          <p className="mt-3 text-sm text-slate">
            Official billed identity and totals are frozen. Payments, reversals
            and credit notes update the current financial ledger only.
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
            <dt>Original billed total</dt>
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
              due_date: dueDate,
              version: invoice.version,
            });
          }}
        >
          <h2 className="font-semibold">Draft financial values</h2>
          <label className="text-sm font-medium" htmlFor="invoice-discount-type">
            Discount
            <NativeSelect
              id="invoice-discount-type"
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
            <label className="text-sm font-medium" htmlFor="invoice-discount-value">
              Discount value
              <Input
                id="invoice-discount-value"
                className="mt-2"
                value={discountValue}
                onChange={(event) => setDiscountValue(event.target.value)}
              />
            </label>
          )}
          <label className="text-sm font-medium" htmlFor="invoice-tax-rate">
            Tax rate (%)
            <Input
              id="invoice-tax-rate"
              className="mt-2"
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium" htmlFor="invoice-due-date">
            Due date
            <Input
              id="invoice-due-date"
              className="mt-2"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium" htmlFor="invoice-notes">
            Invoice note
            <Input
              id="invoice-notes"
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
        <h2 className="mb-2 font-semibold">Current financial ledger</h2>
        <p className="mb-3 text-sm text-slate">
          Ledger amounts are derived from immutable payments, reversals and
          issued credit notes. They do not rewrite the official billed document.
        </p>
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate">Original billed total</dt>
            <dd>{moneyLabel(invoice.total, invoice.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate">Net paid</dt>
            <dd>{moneyLabel(invoice.amount_paid, invoice.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate">Credits</dt>
            <dd>{moneyLabel(invoice.credit_total || '0.00', invoice.currency)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Remaining balance</dt>
            <dd>{moneyLabel(invoice.balance_due, invoice.currency)}</dd>
          </div>
        </dl>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-slate">No payments recorded.</p>
        ) : (
          <ul className="mt-3 grid gap-2 text-sm">
            {payments.map((payment) => {
              const remaining = remainingPayment(payment);
              return (
                <li key={payment.id} className="rounded-md border border-line p-3">
                  <p>
                    {moneyLabel(payment.amount, payment.currency)} ·{' '}
                    {paymentMethodLabels[payment.method]}
                    {parseMoney(payment.reversed_amount || '0.00') > ZERO_CENTS
                      ? ` · Reversed ${moneyLabel(payment.reversed_amount, payment.currency)}`
                      : ''}
                  </p>
                  <p className="text-xs text-slate">
                    {stampLabel(payment.received_at)} by {payment.recorded_by_name}
                    {payment.reference ? ` · ${payment.reference}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a
                      className="text-teal"
                      href={`/api/lab-invoice-payments/${payment.id}/receipt`}
                    >
                      Download receipt
                    </a>
                    {canCorrect &&
                      parseMoney(remaining) > ZERO_CENTS &&
                      invoice.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          className="text-coral"
                          onClick={() => setReversalPaymentId(payment.id)}
                        >
                          Reverse payment
                        </button>
                      )}
                  </div>
                  {canCorrect && reversalPaymentId === payment.id && (
                    <form
                      className="mt-3 grid gap-2 rounded-md bg-mint p-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void send(
                          `/api/lab-invoice-payments/${payment.id}/reverse`,
                          'POST',
                          {
                            amount: reversalAmount || remaining,
                            reason: reversalReason,
                            version: invoice.version,
                          },
                        );
                      }}
                    >
                      <label className="text-sm font-medium" htmlFor={`reversal-amount-${payment.id}`}>
                        Reversal amount
                        <Input
                          id={`reversal-amount-${payment.id}`}
                          className="mt-2"
                          value={reversalAmount}
                          onChange={(event) => setReversalAmount(event.target.value)}
                          placeholder={remaining}
                          required
                        />
                      </label>
                      <label className="text-sm font-medium" htmlFor={`reversal-reason-${payment.id}`}>
                        Reason
                        <Input
                          id={`reversal-reason-${payment.id}`}
                          className="mt-2"
                          value={reversalReason}
                          onChange={(event) => setReversalReason(event.target.value)}
                          required
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
                      >
                        Save reversal
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {reversals.length > 0 && (
          <ul className="mt-3 grid gap-2 text-sm">
            {reversals.map((reversal) => (
              <li key={reversal.id} className="text-slate">
                Reversal {moneyLabel(reversal.amount, reversal.currency)} on{' '}
                {stampLabel(reversal.created_at)} by {reversal.recorded_by_name}:{' '}
                {reversal.reason}
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
            <label className="text-sm font-medium" htmlFor="payment-amount">
              Amount
              <Input
                id="payment-amount"
                className="mt-2"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="text-sm font-medium" htmlFor="payment-method">
              Method
              <NativeSelect
                id="payment-method"
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
            <label className="text-sm font-medium" htmlFor="payment-reference">
              Reference
              <Input
                id="payment-reference"
                className="mt-2"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium" htmlFor="payment-notes">
              Notes
              <Input
                id="payment-notes"
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
      <section className="mb-4 rounded-md border border-line bg-white p-5">
        <h2 className="mb-2 font-semibold">Credit notes</h2>
        <p className="mb-3 text-sm text-slate">
          Issued credit notes reduce remaining balance. They do not rewrite the
          original billed invoice.
        </p>
        {creditNotes.length === 0 ? (
          <p className="text-sm text-slate">No credit notes.</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {creditNotes.map((note) => (
              <li key={note.id} className="rounded-md border border-line p-3">
                <p className="font-mono">
                  {note.credit_note_number || 'Draft credit note'}
                </p>
                <p>
                  {creditNoteStatusLabels[note.status]} ·{' '}
                  {moneyLabel(note.total, note.currency)} · {note.reason}
                </p>
                {canCorrect && note.status === 'DRAFT' && (
                  <button
                    type="button"
                    disabled={busy}
                    className="mt-2 rounded-md bg-teal px-4 py-2 text-sm text-white"
                    onClick={() =>
                      void send(`/api/lab-credit-notes/${note.id}/issue`, 'POST', {
                        version: note.version,
                      })
                    }
                  >
                    Issue credit note
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canCorrect && issued && parseMoney(invoice.balance_due) > ZERO_CENTS && (
          <form
            className="mt-4 grid gap-3 rounded-md bg-mint p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send(`/api/lab-invoices/${invoice.id}/credit-notes`, 'POST', {
                amount: creditAmount,
                reason: creditReason,
                notes: '',
                version: invoice.version,
              });
            }}
          >
            <h3 className="font-medium">Create credit note</h3>
            <label className="text-sm font-medium" htmlFor="credit-amount">
              Amount
              <Input
                id="credit-amount"
                className="mt-2"
                value={creditAmount}
                onChange={(event) => setCreditAmount(event.target.value)}
                required
              />
            </label>
            <label className="text-sm font-medium" htmlFor="credit-reason">
              Reason
              <Input
                id="credit-reason"
                className="mt-2"
                value={creditReason}
                onChange={(event) => setCreditReason(event.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
            >
              Save credit note draft
            </button>
          </form>
        )}
      </section>
      {canEmail && invoice.invoice_number && (
        <form
          className="mb-4 grid gap-3 rounded-md border border-line bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send(`/api/lab-invoices/${invoice.id}/email`, 'POST', {
              recipient: emailRecipient,
              version: invoice.version,
            });
          }}
        >
          <h2 className="font-semibold">Email official invoice</h2>
          <p className="text-sm text-slate">
            Sends the frozen invoice PDF. This does not create a patient payment
            link or schedule reminders.
          </p>
          <label className="text-sm font-medium" htmlFor="invoice-email">
            Recipient email
            <Input
              id="invoice-email"
              className="mt-2"
              type="email"
              value={emailRecipient}
              onChange={(event) => setEmailRecipient(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
          >
            Email invoice
          </button>
          {deliveries.length > 0 && (
            <ul className="text-sm text-slate">
              {deliveries.map((delivery) => (
                <li key={delivery.id}>
                  Emailed {delivery.recipient} {stampLabel(delivery.occurred_at)} by{' '}
                  {delivery.recorded_by_name}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
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
