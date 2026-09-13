'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { PublicReportView } from '@/features/reports/types';
import { stampLabel } from '@/features/orders/format';

export function PublicReportAccess({
  token,
  initial,
}: {
  token: string;
  initial:
    | { status: 'unavailable' }
    | { status: 'verify' }
    | { status: 'ready'; view: PublicReportView };
}) {
  const [status, setStatus] = useState(initial.status);
  const [view, setView] = useState(
    initial.status === 'ready' ? initial.view : null,
  );
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (status === 'unavailable') {
    return (
      <section className="rounded-md border border-line bg-white p-6">
        <h1 className="text-2xl font-semibold">Report link unavailable</h1>
        <p className="mt-3 text-slate">
          This report link is unavailable. It may have expired or been revoked.
        </p>
      </section>
    );
  }
  if (status === 'verify') {
    return (
      <section className="rounded-md border border-line bg-white p-6">
        <h1 className="text-2xl font-semibold">Verify access</h1>
        <p className="mt-3 text-slate">
          Enter the 8-digit access PIN provided with this link to open the
          official laboratory report.
        </p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              const response = await fetch(
                `/api/public/reports/${token}/verify`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ pin }),
                },
              );
              const payload = (await response.json()) as {
                message?: string;
                report?: PublicReportView;
              };
              if (!response.ok) {
                setError(
                  payload.message ||
                    'This report link is unavailable. It may have expired or been revoked.',
                );
                return;
              }
              if (!payload.report) {
                setError('The official report could not be opened.');
                return;
              }
              setView(payload.report);
              setStatus('ready');
            } catch {
              setError('The official report could not be opened.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {error && (
            <p className="rounded-md border border-coral/30 p-3 text-sm text-coral" role="alert">
              {error}
            </p>
          )}
          <label className="text-sm font-medium" htmlFor="share-pin">
            Access PIN
            <Input
              id="share-pin"
              className="mt-2"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, '').slice(0, 8))
              }
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy || pin.length !== 8}
            className="w-fit rounded-md bg-teal px-4 py-2 text-sm text-white"
          >
            Continue
          </button>
        </form>
      </section>
    );
  }
  if (!view) return null;
  return (
    <section className="rounded-md border border-line bg-white p-6">
      <p className="text-sm text-slate">Official laboratory report</p>
      <h1 className="mt-1 text-2xl font-semibold">{view.organization_name}</h1>
      <p className="mt-2 text-sm text-slate">
        {[view.organization_address, view.organization_phone, view.organization_email]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {view.superseded && (
        <p className="mt-4 rounded-md border border-coral/30 p-3 text-sm text-coral">
          This is a previous official version. A later report may have been
          issued.
        </p>
      )}
      <dl className="mt-6 grid gap-3 text-sm">
        <div>
          <dt className="text-slate">Report</dt>
          <dd className="font-mono">
            {view.report_number} · v{view.report_version}
          </dd>
        </div>
        <div>
          <dt className="text-slate">Patient</dt>
          <dd>
            {view.patient_name}{' '}
            <span className="font-mono text-xs text-slate">
              {view.patient_number}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-slate">Order</dt>
          <dd className="font-mono">{view.order_number}</dd>
        </div>
        <div>
          <dt className="text-slate">Issued</dt>
          <dd>
            {stampLabel(view.issued_at)}
            {view.issued_by_name ? ` · ${view.issued_by_name}` : ''}
          </dd>
        </div>
      </dl>
      <a
        className="mt-6 inline-flex rounded-md bg-teal px-4 py-2 text-sm text-white"
        href={`/api/public/reports/${token}/pdf`}
        rel="noreferrer nofollow"
        referrerPolicy="no-referrer"
      >
        Download official PDF
      </a>
      <p className="mt-4 text-xs text-slate">
        The PDF is the official clinical document. This page shows identity
        frozen at issuance.
      </p>
    </section>
  );
}
