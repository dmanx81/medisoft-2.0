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
import type { PatientPage } from '@/features/patients/types';
import type { PatientSearch } from '@/features/patients/validation';
import { dateLabel } from '@/features/patients/format';
export function PatientList({
  initial,
  canCreate,
}: {
  initial: PatientPage;
  canCreate: boolean;
}) {
  const [result, setResult] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PatientSearch['status']>('ALL');
  const [sort, setSort] = useState<PatientSearch['sort']>('name');
  const [direction, setDirection] = useState<PatientSearch['direction']>('asc');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  const [applied, setApplied] = useState({
    query: '',
    status: 'ALL' as PatientSearch['status'],
    sort: 'name' as PatientSearch['sort'],
    direction: 'asc' as PatientSearch['direction'],
  });
  async function load(page = 1, useCurrent = true) {
    const criteria = useCurrent ? { query, status, sort, direction } : applied;
    const request = ++requestNumber.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/patients/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...criteria,
          page,
          pageSize: 20,
        }),
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok)
        throw new Error('Patient search is unavailable. Please try again.');
      const data: PatientPage = await response.json();
      if (request === requestNumber.current) {
        setResult(data);
        setApplied(criteria);
      }
    } catch {
      if (request === requestNumber.current) {
        setError('Patient search is unavailable. Please try again.');
        setResult({ patients: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Patients</h1>
          <p className="mt-1 text-sm text-slate">
            Find a record or register a new patient.
          </p>
        </div>
        {canCreate && (
          <Link
            className="inline-flex items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-medium text-white"
            href="/app/patients/new"
          >
            <Plus size={16} aria-hidden="true" />
            New patient
          </Link>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="mb-5 grid items-end gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-[minmax(200px,1fr)_140px_150px_130px_auto]"
      >
        <label className="text-sm font-medium" htmlFor="patient-search">
          Search patients
          <Input
            id="patient-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={150}
            autoComplete="off"
            placeholder="Name, number, ID, phone or email"
            className="mt-2"
          />
        </label>
        <label htmlFor="patient-status" className="text-sm font-medium">
          Status
          <NativeSelect
            id="patient-status"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as PatientSearch['status'])
            }
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </NativeSelect>
        </label>
        <label htmlFor="patient-sort" className="text-sm font-medium">
          Sort by
          <NativeSelect
            id="patient-sort"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as PatientSearch['sort'])
            }
          >
            <option value="name">Name</option>
            <option value="patient_number">Patient number</option>
            <option value="date_of_birth">Birth date</option>
            <option value="updated_at">Last updated</option>
          </NativeSelect>
        </label>
        <label htmlFor="patient-direction" className="text-sm font-medium">
          Direction
          <NativeSelect
            id="patient-direction"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={direction}
            onChange={(event) =>
              setDirection(event.target.value as PatientSearch['direction'])
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </NativeSelect>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-teal px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          <Search size={16} aria-hidden="true" />
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      <div
        className="overflow-hidden rounded-md border border-line bg-white"
        aria-busy={busy}
      >
        <Table>
          <caption className="sr-only">
            Patient records for your organization
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Patient</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Date of birth</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!busy &&
              result.patients.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell className="py-4 pl-4">
                    <Link
                      href={`/app/patients/${patient.id}`}
                      prefetch={false}
                      className="font-medium text-teal underline-offset-4 hover:underline"
                    >
                      {patient.first_name} {patient.last_name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {patient.patient_number}
                  </TableCell>
                  <TableCell>{dateLabel(patient.date_of_birth)}</TableCell>
                  <TableCell>
                    <p>{patient.phone || '—'}</p>
                    <p className="text-xs text-slate">{patient.email}</p>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded border px-2 py-1 text-xs ${patient.status === 'ACTIVE' ? 'border-teal/20 bg-mint text-teal' : 'border-line text-slate'}`}
                    >
                      {patient.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell>{dateLabel(patient.updated_at)}</TableCell>
                </TableRow>
              ))}
            {(busy || !result.patients.length) && (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center">
                  <p className="font-medium">
                    {busy
                      ? 'Loading patients…'
                      : error
                        ? 'Search could not complete'
                        : 'No patients found'}
                  </p>
                  <p className="mt-2 text-sm text-slate">
                    {busy
                      ? ''
                      : query || status !== 'ALL'
                        ? 'Try a different search or status.'
                        : 'New patient records will appear here.'}
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <output aria-live="polite" className="text-slate">
          {result.total} patients · Page {result.page} of{' '}
          {Math.max(1, Math.ceil(result.total / result.pageSize))}
        </output>
        <div className="flex gap-2">
          <button
            disabled={busy || result.page <= 1}
            onClick={() => void load(result.page - 1, false)}
            className="inline-flex items-center gap-1 rounded border border-line bg-white px-3 py-2 disabled:opacity-40"
          >
            <ChevronLeft size={15} aria-hidden="true" />
            Previous
          </button>
          <button
            disabled={busy || result.page * result.pageSize >= result.total}
            onClick={() => void load(result.page + 1, false)}
            className="inline-flex items-center gap-1 rounded border border-line bg-white px-3 py-2 disabled:opacity-40"
          >
            Next
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
