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
import type { PrescriptionTemplatePage } from '@/features/clinical/types';
export function TemplatesList({
  initial,
  canManage,
}: {
  initial: PrescriptionTemplatePage;
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
      const response = await fetch('/api/prescription-templates/search', {
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
      const data: PrescriptionTemplatePage = await response.json();
      if (request === requestNumber.current) setResult(data);
    } catch {
      if (request === requestNumber.current) {
        setError('Template search is unavailable. Please try again.');
        setResult({ templates: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Prescription templates</h1>
          <p className="mt-1 text-sm text-slate">
            Reusable medication sets for this organization. Copying a template into
            a prescription creates independent medication rows.
          </p>
        </div>
        {canManage && (
          <Link
            href="/app/prescription-templates/new"
            prefetch={false}
            className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          >
            New template
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
        <label className="text-sm font-medium" htmlFor="template-search">
          Search templates
          <Input
            id="template-search"
            type="search"
            className="mt-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, category or description"
          />
        </label>
        <label className="text-sm font-medium" htmlFor="template-status">
          Status
          <NativeSelect
            id="template-status"
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
              <TableHead>Template</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Medications</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-slate">
                  No templates found.
                </TableCell>
              </TableRow>
            )}
            {result.templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell>
                  <Link
                    className="text-teal"
                    href={`/app/prescription-templates/${template.id}`}
                  >
                    {template.name}
                  </Link>
                </TableCell>
                <TableCell>{template.category || '—'}</TableCell>
                <TableCell>{template.item_count}</TableCell>
                <TableCell>{template.is_active ? 'Active' : 'Inactive'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
