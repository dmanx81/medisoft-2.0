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
import type { CatalogueLookups, LabTestPage } from '@/features/catalogue/types';
import type { CatalogueSearch } from '@/features/catalogue/validation';
import { specimenLabels } from '@/features/catalogue/format';
export function CatalogueList({
  initial,
  lookups,
  canCreate,
}: {
  initial: LabTestPage;
  lookups: CatalogueLookups;
  canCreate: boolean;
}) {
  const [result, setResult] = useState(initial);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CatalogueSearch['status']>('ALL');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<CatalogueSearch['sort']>('code');
  const [direction, setDirection] = useState<CatalogueSearch['direction']>(
    'asc',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestNumber = useRef(0);
  const [applied, setApplied] = useState({
    query: '',
    status: 'ALL' as CatalogueSearch['status'],
    category_id: '',
    sort: 'code' as CatalogueSearch['sort'],
    direction: 'asc' as CatalogueSearch['direction'],
  });
  async function load(page = 1, useCurrent = true) {
    const criteria = useCurrent
      ? { query, status, category_id: categoryId, sort, direction }
      : applied;
    const request = ++requestNumber.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tests/search', {
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
        throw new Error('Catalogue search is unavailable. Please try again.');
      const data: LabTestPage = await response.json();
      if (request === requestNumber.current) {
        setResult(data);
        setApplied(criteria);
      }
    } catch {
      if (request === requestNumber.current) {
        setError('Catalogue search is unavailable. Please try again.');
        setResult({ tests: [], total: 0, page: 1, pageSize: 20 });
      }
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tests</h1>
          <p className="mt-1 text-sm text-slate">
            Laboratory catalogue and reference ranges for this organization.
          </p>
        </div>
        {canCreate && (
          <Link
            className="inline-flex items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-medium text-white"
            href="/app/management/tests/new"
          >
            <Plus size={16} aria-hidden="true" />
            New test
          </Link>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="mb-5 grid items-end gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-[minmax(180px,1fr)_160px_140px_140px_120px_auto]"
      >
        <label className="text-sm font-medium" htmlFor="test-search">
          Search tests
          <Input
            id="test-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder="Code, name or category"
            className="mt-2"
          />
        </label>
        <label htmlFor="test-category" className="text-sm font-medium">
          Category
          <NativeSelect
            id="test-category"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {lookups.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label htmlFor="test-status" className="text-sm font-medium">
          Status
          <NativeSelect
            id="test-status"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as CatalogueSearch['status'])
            }
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </NativeSelect>
        </label>
        <label htmlFor="test-sort" className="text-sm font-medium">
          Sort by
          <NativeSelect
            id="test-sort"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as CatalogueSearch['sort'])
            }
          >
            <option value="code">Code</option>
            <option value="name">Name</option>
            <option value="category">Category</option>
            <option value="updated_at">Last updated</option>
          </NativeSelect>
        </label>
        <label htmlFor="test-direction" className="text-sm font-medium">
          Direction
          <NativeSelect
            id="test-direction"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={direction}
            onChange={(event) =>
              setDirection(event.target.value as CatalogueSearch['direction'])
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
            Laboratory tests for your organization
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Code</TableHead>
              <TableHead>Test</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Specimen</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!busy &&
              result.tests.map((test) => (
                <TableRow key={test.id}>
                  <TableCell className="py-3 pl-4 font-mono text-xs">
                    <Link
                      href={`/app/management/tests/${test.id}`}
                      prefetch={false}
                      className="font-medium text-teal underline-offset-4 hover:underline"
                    >
                      {test.code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{test.name}</p>
                    {test.short_name ? (
                      <p className="text-xs text-slate">{test.short_name}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>{test.category_name}</TableCell>
                  <TableCell>
                    {specimenLabels[test.specimen_type] ?? test.specimen_type}
                  </TableCell>
                  <TableCell>{test.unit_symbol || '—'}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded border px-2 py-1 text-xs ${test.is_active ? 'border-teal/20 bg-mint text-teal' : 'border-line text-slate'}`}
                    >
                      {test.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            {(busy || !result.tests.length) && (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center">
                  <p className="font-medium">
                    {busy
                      ? 'Loading tests…'
                      : error
                        ? 'Search could not complete'
                        : 'No tests found'}
                  </p>
                  <p className="mt-2 text-sm text-slate">
                    {busy
                      ? ''
                      : query || status !== 'ALL' || categoryId
                        ? 'Try a different search, category or status.'
                        : 'New catalogue entries will appear here.'}
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <output aria-live="polite" className="text-slate">
          {result.total} tests · Page {result.page} of{' '}
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
