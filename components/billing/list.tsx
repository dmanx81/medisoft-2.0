'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { InvoiceWorkItem } from '@/features/billing/types';
import { invoiceStatusLabels, moneyLabel } from '@/features/billing/format';
import { stampLabel } from '@/features/orders/format';
type WorkPage = {
  invoices: InvoiceWorkItem[];
  total: number;
  page: number;
  pageSize: number;
};
export function InvoiceList({ initial }: { initial: WorkPage }) {
  const [result, setResult] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  async function load(page = 1) {
    const request = ++requestNumber.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/lab-invoices/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, status, page, pageSize: 20 }),
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok)
        throw new Error('Invoice search is unavailable. Please try again.');
      const data: WorkPage = await response.json();
      if (request === requestNumber.current) setResult(data);
    } catch {
      if (request === requestNumber.current) {
        setError('Invoice search is unavailable. Please try again.');
        setResult({ invoices: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Laboratory billing</h1>
        <p className="mt-1 text-sm text-slate">
          Issued invoice names, tests and prices come from each invoice&apos;s
          frozen snapshot. Payments change the current balance, not the billed
          document.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-4"
      >
        <label className="text-sm font-medium" htmlFor="invoice-search">
          Search invoices
          <Input
            id="invoice-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            className="mt-2 w-72"
          />
        </label>
        <label className="text-sm font-medium" htmlFor="invoice-status">
          Status
          <NativeSelect
            id="invoice-status"
            className="mt-2 h-9 min-w-44"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(invoiceStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-teal px-4 py-2 text-sm text-white"
        >
          Search
        </button>
      </form>
      {error && (
        <p className="mb-4 text-sm text-coral" role="alert">
          {error}
        </p>
      )}
      <div className="overflow-hidden rounded-md border border-line bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-slate">
                  No laboratory invoices.
                </TableCell>
              </TableRow>
            ) : (
              result.invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono text-sm">
                    <Link className="text-teal" href={`/app/billing/${invoice.id}`}>
                      {invoice.invoice_number || 'Draft'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {invoice.patient_first_name} {invoice.patient_last_name}{' '}
                    <span className="font-mono text-xs text-slate">
                      {invoice.patient_number}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      className="font-mono text-teal"
                      href={`/app/laboratory/orders/${invoice.order_id}`}
                    >
                      {invoice.order_number}
                    </Link>
                  </TableCell>
                  <TableCell>{stampLabel(invoice.issued_at)}</TableCell>
                  <TableCell>
                    {moneyLabel(invoice.total, invoice.currency)}
                  </TableCell>
                  <TableCell>
                    {moneyLabel(invoice.amount_paid, invoice.currency)}
                  </TableCell>
                  <TableCell>
                    {moneyLabel(invoice.balance_due, invoice.currency)}
                  </TableCell>
                  <TableCell>
                    <span className="rounded border border-line bg-mint px-2 py-0.5 text-xs text-teal">
                      {invoiceStatusLabels[invoice.status]}
                      {invoice.overdue ? ' · Overdue' : ''}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <p className="text-slate">
          {result.total} invoice{result.total === 1 ? '' : 's'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || result.page <= 1}
            className="rounded-md border border-line px-3 py-1"
            onClick={() => void load(result.page - 1)}
          >
            <ChevronLeft className="inline size-4" /> Previous
          </button>
          <button
            type="button"
            disabled={busy || result.page * result.pageSize >= result.total}
            className="rounded-md border border-line px-3 py-1"
            onClick={() => void load(result.page + 1)}
          >
            Next <ChevronRight className="inline size-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
