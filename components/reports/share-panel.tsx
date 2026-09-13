'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { CreatedReportShare, LabReport, LabReportShare } from '@/features/reports/types';
import {
  shareExpiryLabels,
  shareStatusLabels,
} from '@/features/reports/format';
import { stampLabel } from '@/features/orders/format';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement('textarea');
  field.value = value;
  document.body.appendChild(field);
  field.select();
  document.execCommand('copy');
  field.remove();
}

export function ReportSharePanel({
  report,
  canShare,
  canRevoke,
  busy,
  onFailure,
}: {
  report: LabReport;
  canShare: boolean;
  canRevoke: boolean;
  busy: boolean;
  onFailure: (failure: Failure | null) => void;
}) {
  const [shares, setShares] = useState<LabReportShare[]>([]);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [expiresIn, setExpiresIn] = useState('24h');
  const [created, setCreated] = useState<CreatedReportShare | null>(null);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    if (!canShare) return;
    let cancelled = false;
    void fetch(`/api/lab-reports/${report.id}/shares`).then(async (response) => {
      if (!response.ok || cancelled) return;
      setShares((await response.json()) as LabReportShare[]);
    });
    return () => {
      cancelled = true;
    };
  }, [canShare, report.id]);
  if (!canShare) return null;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h4 className="mb-2 text-sm font-medium">
        Secure share · {report.report_number}
        {report.is_current ? '' : ' · previous version'}
      </h4>
      <form
        className="grid gap-2 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          onFailure(null);
          setCopied('');
          const response = await fetch(`/api/lab-reports/${report.id}/shares`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient_name: recipientName,
              recipient_email: recipientEmail,
              purpose,
              expires_in: expiresIn,
            }),
          });
          const payload = (await response.json()) as Failure & CreatedReportShare;
          if (response.status === 401) {
            window.location.assign('/login');
            return;
          }
          if (!response.ok) {
            onFailure(payload);
            return;
          }
          setCreated(payload);
          setShares((current) => [payload.share, ...current]);
          setRecipientName('');
          setRecipientEmail('');
          setPurpose('');
        }}
      >
        <label className="text-xs font-medium" htmlFor={`share-name-${report.id}`}>
          Recipient name
          <Input
            id={`share-name-${report.id}`}
            className="mt-1"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            maxLength={160}
            placeholder="Optional"
          />
        </label>
        <label className="text-xs font-medium" htmlFor={`share-email-${report.id}`}>
          Recipient email
          <Input
            id={`share-email-${report.id}`}
            className="mt-1"
            type="email"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            maxLength={254}
            placeholder="Optional"
          />
        </label>
        <label className="text-xs font-medium" htmlFor={`share-purpose-${report.id}`}>
          Purpose
          <Input
            id={`share-purpose-${report.id}`}
            className="mt-1"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            maxLength={200}
            placeholder="Optional"
          />
        </label>
        <label className="text-xs font-medium" htmlFor={`share-expiry-${report.id}`}>
          Link expires
          <NativeSelect
            id={`share-expiry-${report.id}`}
            className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2"
            value={expiresIn}
            onChange={(event) => setExpiresIn(event.target.value)}
          >
            {Object.entries(shareExpiryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="self-end rounded-md bg-teal px-3 py-2 text-sm text-white"
        >
          Create secure link
        </button>
      </form>
      {created && (
        <div className="mt-3 rounded-md border border-teal/20 bg-mint p-3 text-sm">
          <p className="font-medium">
            Share created for {created.share.report_number}. The PIN is shown once.
          </p>
          <p className="mt-2 break-all font-mono text-xs">{created.url}</p>
          <p className="mt-1 font-mono">PIN {created.pin}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-teal px-2 py-1 text-xs text-teal"
              onClick={() => {
                void copyText(created.url).then(() => setCopied('link'));
              }}
            >
              Copy link
            </button>
            <button
              type="button"
              className="rounded-md border border-teal px-2 py-1 text-xs text-teal"
              onClick={() => {
                void copyText(created.pin).then(() => setCopied('pin'));
              }}
            >
              Copy PIN
            </button>
            <button
              type="button"
              className="rounded-md border border-teal px-2 py-1 text-xs text-teal"
              onClick={() => {
                void copyText(created.message).then(() => setCopied('message'));
              }}
            >
              Copy patient message
            </button>
          </div>
          {copied && (
            <p className="mt-2 text-xs text-teal">
              {copied === 'pin'
                ? 'PIN copied.'
                : copied === 'message'
                  ? 'Patient message copied.'
                  : 'Link copied.'}
            </p>
          )}
        </div>
      )}
      {shares.length > 0 && (
        <ul className="mt-3 grid gap-2 text-xs">
          {shares.map((share) => (
            <li key={share.id} className="rounded-md border border-line p-3">
              <p>
                {share.report_number} v{share.report_version} ·{' '}
                {shareStatusLabels[share.status]}
                {share.is_current ? '' : ' · previous version'}
              </p>
              <p className="text-slate">
                {share.recipient_name || share.recipient_email || 'No recipient named'}
                {share.purpose ? ` · ${share.purpose}` : ''}
              </p>
              <p className="text-slate">
                Created {stampLabel(share.created_at)} by {share.created_by_name} ·
                Expires {stampLabel(share.expires_at)}
                {share.last_accessed_at
                  ? ` · Last accessed ${stampLabel(share.last_accessed_at)} (${share.access_count})`
                  : ''}
              </p>
              {share.status === 'REVOKED' && (
                <p className="text-slate">
                  Revoked {stampLabel(share.revoked_at)} by {share.revoked_by_name}
                </p>
              )}
              {canRevoke && share.status === 'ACTIVE' && (
                <button
                  type="button"
                  className="mt-2 rounded-md border border-coral px-2 py-1 text-coral"
                  onClick={async () => {
                    onFailure(null);
                    const response = await fetch(
                      `/api/lab-report-shares/${share.id}/revoke`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: '{}',
                      },
                    );
                    const payload = (await response.json()) as Failure & LabReportShare;
                    if (response.status === 401) {
                      window.location.assign('/login');
                      return;
                    }
                    if (!response.ok) {
                      onFailure(payload);
                      return;
                    }
                    setShares((current) =>
                      current.map((row) => (row.id === payload.id ? payload : row)),
                    );
                    if (created?.share.id === payload.id)
                      setCreated((current) =>
                        current ? { ...current, share: payload } : current,
                      );
                  }}
                >
                  Revoke link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
