'use client';
import { useState } from 'react';
import type { PatientActivity } from '@/features/patients/types';
import { patientFieldLabels } from './fields';
const labels: Record<string, string> = {
  PATIENT_CREATED: 'Patient created',
  PATIENT_UPDATED: 'Patient updated',
  PATIENT_STATUS_CHANGED: 'Status changed',
};
export function Activity({ patientId }: { patientId: string }) {
  const [entries, setEntries] = useState<PatientActivity[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/patients/${patientId}/activity?page=${page + 1}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error();
      const data: PatientActivity[] = await response.json();
      setEntries((current) => [...current, ...data.slice(0, 20)]);
      setMore(data.length > 20);
      setPage((current) => current + 1);
    } catch {
      setError('Activity could not be loaded. Check your access or try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2 className="text-lg font-semibold">Patient activity</h2>
      <p className="mt-1 text-sm text-slate">
        Who changed this record and which fields were affected.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
      <ol className="mt-5 divide-y divide-line">
        {entries.map((entry) => (
          <li key={entry.id} className="py-4">
            <p className="font-medium">
              {labels[entry.action] ?? 'Patient activity'}
            </p>
            <p className="mt-1 text-sm text-slate">
              {entry.actor} · {new Date(entry.occurred_at).toLocaleString()}
            </p>
            {entry.metadata.fields?.length ? (
              <p className="mt-1 text-sm text-slate">
                Fields:{' '}
                {entry.metadata.fields
                  .map((field) => patientFieldLabels[field] ?? field)
                  .join(', ')}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {page > 0 && !entries.length && (
        <p className="py-4 text-sm text-slate">No activity recorded.</p>
      )}
      {more && (
        <button
          onClick={() => void load()}
          disabled={busy}
          className="mt-4 rounded-md border border-line px-4 py-2 text-sm"
        >
          {busy ? 'Loading…' : page ? 'Load older activity' : 'Load activity'}
        </button>
      )}
    </section>
  );
}
