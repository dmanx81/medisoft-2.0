'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { InvoiceContext, LabInvoice } from '@/features/billing/types';
import {
  invoiceStatusLabels,
  moneyLabel,
  paymentMethodLabels,
} from '@/features/billing/format';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function BillingPanel({
  orderId,
  orderVersion,
  canRead,
  canCreate,
  canIssue,
  canPay,
  busy,
  onFailure,
  onBusy,
  onActivity,
}: {
  orderId: string;
  orderVersion: number;
  canRead: boolean;
  canCreate: boolean;
  canIssue: boolean;
  canPay: boolean;
  busy: boolean;
  onFailure: (failure: Failure | null) => void;
  onBusy: (value: boolean) => void;
  onActivity: () => void;
}) {
  const [context, setContext] = useState<InvoiceContext | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    void fetch(`/api/lab-orders/${orderId}/invoice-context`).then(
      async (response) => {
        if (!response.ok || cancelled) return;
        setContext((await response.json()) as InvoiceContext);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canRead, orderId, orderVersion]);
  if (!canRead) return null;
  const invoice = context?.invoice ?? null;
  async function mutate(
    path: string,
    methodName: string,
    body: unknown,
  ) {
    onBusy(true);
    onFailure(null);
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
        onFailure(payload);
        return;
      }
      const refreshed = await fetch(`/api/lab-orders/${orderId}/invoice-context`);
      if (refreshed.ok) setContext((await refreshed.json()) as InvoiceContext);
      onActivity();
    } finally {
      onBusy(false);
    }
  }
  return (
    <section className="rounded-md border border-line bg-white p-5">
      <h2 className="mb-4 font-semibold">Billing</h2>
      <p className="mb-3 text-sm text-slate">
        Financial status is independent of clinical results. An unpaid order may
        still be completed and reported.
      </p>
      {context && (
        <p className="mb-3 text-sm">
          Billable {moneyLabel(context.preview.total, context.currency)} from{' '}
          {context.billable.length} active test
          {context.billable.length === 1 ? '' : 's'}
        </p>
      )}
      {invoice ? (
        <div className="mb-4 rounded-md border border-line p-4 text-sm">
          <p className="font-mono">
            <Link className="text-teal" href={`/app/billing/${invoice.id}`}>
              {invoice.invoice_number || 'Draft invoice'}
            </Link>
          </p>
          <p className="mt-1 text-slate">
            {invoiceStatusLabels[invoice.status]} · Total{' '}
            {moneyLabel(invoice.total, invoice.currency)} · Paid{' '}
            {moneyLabel(invoice.amount_paid, invoice.currency)} · Balance{' '}
            {moneyLabel(invoice.balance_due, invoice.currency)}
          </p>
          {invoice.status !== 'DRAFT' && (
            <a
              className="mt-2 inline-block text-teal"
              href={`/api/lab-invoices/${invoice.id}/pdf`}
            >
              Download invoice
            </a>
          )}
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate">No invoice for this order yet.</p>
      )}
      {canCreate && !invoice && context && context.billable.length > 0 && (
        <button
          type="button"
          disabled={busy}
          className="mb-3 rounded-md bg-teal px-4 py-2 text-sm text-white"
          onClick={() =>
            void mutate(`/api/lab-orders/${orderId}/invoices`, 'POST', {})
          }
        >
          Create invoice
        </button>
      )}
      {canIssue && invoice?.status === 'DRAFT' && (
        <button
          type="button"
          disabled={busy}
          className="mb-3 ml-2 rounded-md bg-teal px-4 py-2 text-sm text-white"
          onClick={() =>
            void mutate(`/api/lab-invoices/${invoice.id}/issue`, 'POST', {
              version: invoice.version,
            })
          }
        >
          Issue invoice
        </button>
      )}
      {canPay &&
        invoice &&
        (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') && (
          <form
            className="mt-3 grid gap-3 rounded-md bg-mint p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate(`/api/lab-invoices/${invoice.id}/payments`, 'POST', {
                amount,
                method,
                reference,
                notes: '',
                version: invoice.version,
              });
            }}
          >
            <h3 className="font-medium">Record payment</h3>
            <label className="text-sm font-medium" htmlFor="order-payment-amount">
              Amount
              <Input
                id="order-payment-amount"
                className="mt-2"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="text-sm font-medium" htmlFor="order-payment-method">
              Method
              <NativeSelect
                id="order-payment-method"
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
            <label className="text-sm font-medium" htmlFor="order-payment-reference">
              Reference
              <Input
                id="order-payment-reference"
                className="mt-2"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
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
  );
}
