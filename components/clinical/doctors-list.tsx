'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ClinicalDoctorPage } from '@/features/clinical/types';
import { doctorStatusLabels } from '@/features/clinical/format';
export function DoctorsList({
  initial,
  canManage,
}: {
  initial: ClinicalDoctorPage;
  canManage: boolean;
}) {
  const [result, setResult] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  async function load(page = 1) {
    const request = ++requestNumber.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/clinical-doctors/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, status, page, pageSize: 20 }),
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) throw new Error('unavailable');
      const data: ClinicalDoctorPage = await response.json();
      if (request === requestNumber.current) setResult(data);
    } catch {
      if (request === requestNumber.current) {
        setError('Doctor search is unavailable. Please try again.');
        setResult({ doctors: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Doctors</h1>
          <p className="mt-1 text-sm text-slate">
            Clinical doctor profiles belong to this organization and are used when
            finalizing prescriptions.
          </p>
        </div>
        {canManage && (
          <Link
            href="/app/doctors/new"
            prefetch={false}
            className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          >
            New doctor
          </Link>
        )}
      </div>
      <form
        className="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-line bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label className="text-sm font-medium" htmlFor="doctor-search">
          Search doctors
          <Input
            id="doctor-search"
            type="search"
            className="mt-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium" htmlFor="doctor-status">
          Status
          <NativeSelect
            id="doctor-status"
            className="mt-2"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </NativeSelect>
        </label>
        <button
          type="submit"
          className="rounded-md border border-line px-4 py-2 text-sm"
          disabled={busy}
        >
          Search
        </button>
      </form>
      {error && (
        <p className="mb-4 text-sm text-coral" role="alert">
          {error}
        </p>
      )}
      <div className="rounded-md border border-line bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Doctor</TableHead>
              <TableHead>Specialty</TableHead>
              <TableHead>License</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.doctors.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-slate">
                  No doctors found.
                </TableCell>
              </TableRow>
            )}
            {result.doctors.map((doctor) => (
              <TableRow key={doctor.id}>
                <TableCell>
                  <Link className="text-teal" href={`/app/doctors/${doctor.id}`}>
                    {doctor.title ? `${doctor.title} ` : ''}
                    {doctor.display_name}
                  </Link>
                </TableCell>
                <TableCell>{doctor.specialty || '—'}</TableCell>
                <TableCell className="font-mono text-xs">
                  {doctor.license_number || '—'}
                </TableCell>
                <TableCell>{doctorStatusLabels[doctor.status]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
