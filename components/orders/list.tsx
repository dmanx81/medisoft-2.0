'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import type { LabOrderPage } from '@/features/orders/types';
import type { OrderSearch } from '@/features/orders/validation';
import {
  coverageLabel,
  orderStatusLabels,
  priorityLabels,
  stampLabel,
} from '@/features/orders/format';
export function OrderList({
  initial,
  canCreate,
}: {
  initial: LabOrderPage;
  canCreate: boolean;
}) {
  const [result, setResult] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OrderSearch['status']>('ALL');
  const [priority, setPriority] = useState<OrderSearch['priority']>('ALL');
  const [orderedFrom, setOrderedFrom] = useState('');
  const [orderedTo, setOrderedTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  const [applied, setApplied] = useState({
    query: '',
    status: 'ALL' as OrderSearch['status'],
    priority: 'ALL' as OrderSearch['priority'],
    ordered_from: '',
    ordered_to: '',
  });
  async function load(page = 1, useCurrent = true) {
    const criteria = useCurrent
      ? {
          query,
          status,
          priority,
          ordered_from: orderedFrom,
          ordered_to: orderedTo,
        }
      : applied;
    const request = ++requestNumber.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/lab-orders/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...criteria, page, pageSize: 20 }),
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok)
        throw new Error('Order search is unavailable. Please try again.');
      const data: LabOrderPage = await response.json();
      if (request === requestNumber.current) {
        setResult(data);
        setApplied(criteria);
      }
    } catch {
      if (request === requestNumber.current) {
        setError('Order search is unavailable. Please try again.');
        setResult({ orders: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Laboratory orders</h1>
          <p className="mt-1 text-sm text-slate">
            Create orders, collect specimens and accession samples for this
            organization.
          </p>
        </div>
        {canCreate && (
          <Link
            className="inline-flex items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-medium text-white"
            href="/app/laboratory/orders/new"
          >
            <Plus size={16} aria-hidden="true" />
            New order
          </Link>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="mb-5 grid items-end gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-[minmax(180px,1fr)_150px_130px_140px_140px_auto]"
      >
        <label className="text-sm font-medium" htmlFor="order-search">
          Search orders
          <Input
            id="order-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder="Order number or patient"
            className="mt-2"
          />
        </label>
        <label htmlFor="order-status" className="text-sm font-medium">
          Status
          <NativeSelect
            id="order-status"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as OrderSearch['status'])
            }
          >
            <option value="ALL">All statuses</option>
            {Object.entries(orderStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label htmlFor="order-priority" className="text-sm font-medium">
          Priority
          <NativeSelect
            id="order-priority"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as OrderSearch['priority'])
            }
          >
            <option value="ALL">All</option>
            <option value="ROUTINE">Routine</option>
            <option value="URGENT">Urgent</option>
          </NativeSelect>
        </label>
        <label htmlFor="order-from" className="text-sm font-medium">
          From
          <Input
            id="order-from"
            type="date"
            value={orderedFrom}
            onChange={(event) => setOrderedFrom(event.target.value)}
            className="mt-2"
          />
        </label>
        <label htmlFor="order-to" className="text-sm font-medium">
          To
          <Input
            id="order-to"
            type="date"
            value={orderedTo}
            onChange={(event) => setOrderedTo(event.target.value)}
            className="mt-2"
          />
        </label>
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-teal px-4 text-sm font-medium text-white"
        >
          <Search size={16} aria-hidden="true" />
          Search
        </button>
      </form>
      {error && (
        <p className="mb-4 rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border border-line bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Tests</TableHead>
              <TableHead>Specimens</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-slate">
                  {busy ? 'Searching…' : 'No orders found'}
                </TableCell>
              </TableRow>
            ) : (
              result.orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      href={`/app/laboratory/orders/${order.id}`}
                      className="font-mono text-sm text-teal"
                    >
                      {order.order_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {order.patient_last_name}, {order.patient_first_name}
                    <div className="font-mono text-xs text-slate">
                      {order.patient_number}
                    </div>
                  </TableCell>
                  <TableCell>{stampLabel(order.ordered_at || order.created_at)}</TableCell>
                  <TableCell>
                    <span
                      className={
                        order.priority === 'URGENT'
                          ? 'font-medium text-coral'
                          : ''
                      }
                    >
                      {priorityLabels[order.priority]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {coverageLabel(
                      Number(order.covered_count),
                      Number(order.test_count),
                    )}
                  </TableCell>
                  <TableCell>{order.specimen_count}</TableCell>
                  <TableCell>{orderStatusLabels[order.status]}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-slate">
        <p>
          {result.total} order{result.total === 1 ? '' : 's'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 disabled:opacity-50"
            disabled={result.page <= 1 || busy}
            onClick={() => void load(result.page - 1, false)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Previous
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 disabled:opacity-50"
            disabled={
              result.page * result.pageSize >= result.total || busy
            }
            onClick={() => void load(result.page + 1, false)}
          >
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
