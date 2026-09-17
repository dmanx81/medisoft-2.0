'use client';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type {
  PrescriptionItemInput,
  PrescriptionTemplate,
  PrescriptionTemplatePage,
} from '@/features/clinical/types';
export function TemplatePicker({
  onApply,
}: {
  onApply: (template: {
    id: string;
    name: string;
    items: PrescriptionItemInput[];
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<PrescriptionTemplatePage>({
    templates: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [preview, setPreview] = useState<PrescriptionTemplate | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestNumber = useRef(0);
  async function search(nextQuery = query) {
    const request = ++requestNumber.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/prescription-templates/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: nextQuery,
          status: 'ACTIVE',
          pageSize: 20,
        }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('unavailable');
      const data: PrescriptionTemplatePage = await response.json();
      if (request === requestNumber.current) setResult(data);
    } catch {
      if (request === requestNumber.current)
        setError('Templates could not be loaded.');
    } finally {
      if (request === requestNumber.current) setBusy(false);
    }
  }
  async function showPreview(id: string) {
    setError('');
    const response = await fetch(`/api/prescription-templates/${id}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      setError('Template preview is unavailable.');
      return;
    }
    setPreview((await response.json()) as PrescriptionTemplate);
  }
  return (
    <div>
      <button
        type="button"
        className="text-sm text-teal"
        onClick={() => {
          const next = !open;
          setOpen(next);
          setPreview(null);
          if (next) void search();
        }}
      >
        Use template
      </button>
      {open && (
        <div className="mt-3 rounded-md border border-line bg-white p-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <label className="min-w-48 flex-1 text-sm font-medium" htmlFor="rx-template-search">
              Search active templates
              <Input
                id="rx-template-search"
                type="search"
                className="mt-2"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
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
            <p className="mt-3 text-sm text-coral" role="alert">
              {error}
            </p>
          )}
          <ul className="mt-4 grid gap-2">
            {result.templates.length === 0 && (
              <li className="text-sm text-slate">No active templates found.</li>
            )}
            {result.templates.map((template) => (
              <li
                key={template.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{template.name}</p>
                  <p className="text-xs text-slate">
                    {template.item_count}{' '}
                    {template.item_count === 1 ? 'medication' : 'medications'}
                    {template.category ? ` · ${template.category}` : ''}
                  </p>
                </div>
                <div className="flex gap-3 text-sm">
                  <button
                    type="button"
                    className="text-teal"
                    onClick={() => void showPreview(template.id)}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    className="text-teal"
                    onClick={() => {
                      void (async () => {
                        const response = await fetch(
                          `/api/prescription-templates/${template.id}`,
                          { cache: 'no-store' },
                        );
                        if (!response.ok) {
                          setError('Template could not be applied.');
                          return;
                        }
                        const detail = (await response.json()) as PrescriptionTemplate;
                        onApply({
                          id: detail.id,
                          name: detail.name,
                          items: detail.items.map(
                            ({ id: _id, sort_order: _order, ...item }) => item,
                          ),
                        });
                        setOpen(false);
                        setPreview(null);
                      })();
                    }}
                  >
                    Use
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {preview && (
            <div className="mt-4 rounded-md border border-line p-3">
              <h3 className="text-sm font-medium">{preview.name}</h3>
              <ol className="mt-2 list-decimal pl-5 text-sm">
                {preview.items.map((item) => (
                  <li key={item.id} className="mt-1">
                    {item.medication_name}
                    {item.strength ? ` ${item.strength}` : ''}
                    {item.dose ? ` · ${item.dose}` : ''}
                    {item.frequency ? ` · ${item.frequency}` : ''}
                    {item.duration ? ` · ${item.duration}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
