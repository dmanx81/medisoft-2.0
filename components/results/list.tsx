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
import type { ResultWorkItem } from '@/features/results/types';
import { orderStatusLabels, priorityLabels, stampLabel } from '@/features/orders/format';
type WorkPage = {
  orders: ResultWorkItem[];
  total: number;
  page: number;
  pageSize: number;
};
export function ResultWorkList({ initial }: { initial: WorkPage }) {
  const [result, setResult] = useState(initial);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  async function load(page = 1) {
    const request = ++requestNumber.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/lab-results/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, page, pageSize: 20 }),
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok)
        throw new Error('Result search is unavailable. Please try again.');
      const data: WorkPage = await response.json();
      if (request === requestNumber.current) setResult(data);
    } catch {
      if (request === requestNumber.current) {
        setError('Result search is unavailable. Please try again.');
        setResult({ orders: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Laboratory results</h1>
        <p className="mt-1 text-sm text-slate">
          Enter, technically validate and clinically verify results for received
          orders in this organization.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-4"
      >
        <label className="text-sm font-medium" htmlFor="result-search">
          Search received orders
          <Input
            id="result-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            className="mt-2 w-72"
          />
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
              <TableHead>Order</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Entered</TableHead>
              <TableHead>Ordered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-slate">
                  No received orders awaiting results.
                </TableCell>
              </TableRow>
            ) : (
              result.orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link className="font-mono text-teal" href={`/app/laboratory/orders/${order.id}`}>
                      {order.order_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {order.patient_first_name} {order.patient_last_name}{' '}
                    <span className="font-mono text-xs text-slate">
                      {order.patient_number}
                    </span>
                  </TableCell>
                  <TableCell>{orderStatusLabels[order.status]}</TableCell>
                  <TableCell>{priorityLabels[order.priority]}</TableCell>
                  <TableCell>{order.pending_results}</TableCell>
                  <TableCell>{order.entered_results}</TableCell>
                  <TableCell>{stampLabel(order.ordered_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2 text-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1"
          disabled={busy || result.page <= 1}
          onClick={() => void load(result.page - 1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Previous
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1"
          disabled={
            busy || result.page * result.pageSize >= result.total
          }
          onClick={() => void load(result.page + 1)}
        >
          Next
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
