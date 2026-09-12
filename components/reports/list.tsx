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
import type { ReportWorkItem } from '@/features/reports/types';
import { reportStatusLabels } from '@/features/reports/format';
import { stampLabel } from '@/features/orders/format';
type WorkPage = {
  reports: ReportWorkItem[];
  total: number;
  page: number;
  pageSize: number;
};
export function ReportList({
  initial,
  canDownload,
}: {
  initial: WorkPage;
  canDownload: boolean;
}) {
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
      const response = await fetch('/api/lab-reports/search', {
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
        throw new Error('Report search is unavailable. Please try again.');
      const data: WorkPage = await response.json();
      if (request === requestNumber.current) setResult(data);
    } catch {
      if (request === requestNumber.current) {
        setError('Report search is unavailable. Please try again.');
        setResult({ reports: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Laboratory reports</h1>
        <p className="mt-1 text-sm text-slate">
          Issued reports for this organization. Official PDFs are generated from
          frozen snapshots.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-4"
      >
        <label className="text-sm font-medium" htmlFor="report-search">
          Search reports
          <Input
            id="report-search"
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
              <TableHead>Report</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.reports.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-slate">
                  No issued laboratory reports.
                </TableCell>
              </TableRow>
            ) : (
              result.reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-mono text-sm">
                    {report.report_number}
                    {report.is_current ? (
                      <span className="ml-2 rounded border border-line bg-mint px-2 py-0.5 text-xs text-teal">
                        Current
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Link
                      className="font-mono text-teal"
                      href={`/app/laboratory/orders/${report.order_id}`}
                    >
                      {report.order_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {report.patient_first_name} {report.patient_last_name}{' '}
                    <span className="font-mono text-xs text-slate">
                      {report.patient_number}
                    </span>
                  </TableCell>
                  <TableCell>v{report.report_version}</TableCell>
                  <TableCell>{reportStatusLabels[report.status]}</TableCell>
                  <TableCell>
                    {stampLabel(report.issued_at)}
                    <div className="text-xs text-slate">{report.issued_by_name}</div>
                  </TableCell>
                  <TableCell>
                    {canDownload ? (
                      <a
                        className="text-sm text-teal"
                        href={`/api/lab-reports/${report.id}/pdf`}
                      >
                        Download PDF
                      </a>
                    ) : (
                      <span className="text-xs text-slate">Restricted</span>
                    )}
                  </TableCell>
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
          disabled={busy || result.page * result.pageSize >= result.total}
          onClick={() => void load(result.page + 1)}
        >
          Next
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
