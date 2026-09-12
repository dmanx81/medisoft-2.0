'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { LabOrder } from '@/features/orders/types';
import type { LabReport, ReportContext } from '@/features/reports/types';
import {
  deliveryMethodLabels,
  reportStatusLabels,
} from '@/features/reports/format';
import { stampLabel } from '@/features/orders/format';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function ReportPanel({
  order,
  canRead,
  canGenerate,
  canDownload,
  canDeliver,
  busy,
  onSave,
  onFailure,
}: {
  order: LabOrder;
  canRead: boolean;
  canGenerate: boolean;
  canDownload: boolean;
  canDeliver: boolean;
  busy: boolean;
  onSave: (order: LabOrder) => void;
  onFailure: (failure: Failure | null) => void;
}) {
  const reports = order.reports ?? [];
  const current = reports.find((row) => row.is_current) ?? null;
  const [context, setContext] = useState<ReportContext | null>(null);
  const [method, setMethod] = useState('PRINT');
  const [recipient, setRecipient] = useState('');
  const [deliveryMessage, setDeliveryMessage] = useState('');
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    void fetch(`/api/lab-orders/${order.id}/report-context`).then(
      async (response) => {
        if (!response.ok || cancelled) return;
        setContext((await response.json()) as ReportContext);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canRead, order.id, order.status, order.version, current?.id, reports.length]);
  if (!canRead) return null;
  const complete = context?.complete ?? order.status === 'COMPLETED';
  const eligible = context ? context.eligible : complete && !current;
  const needsNew =
    Boolean(context?.needs_new_report) ||
    (reports.length > 0 && order.status === 'IN_PROCESS');
  return (
    <section className="rounded-md border border-line bg-white p-5">
      <h2 className="mb-4 font-semibold">Laboratory reports</h2>
      {order.status === 'COMPLETED' ? (
        <p className="mb-3 rounded-md border border-teal/20 bg-mint p-3 text-sm text-teal">
          This order is clinically complete. All active ordered tests have a
          current clinically verified result.
        </p>
      ) : (
        <p className="mb-3 text-sm text-slate">
          An official report can be issued after every active ordered test is
          clinically verified.
        </p>
      )}
      {needsNew && (
        <p className="mb-3 rounded-md border border-coral/30 bg-white p-3 text-sm text-coral">
          A result was amended after the current report. Issue a new report
          version after the amendment is clinically re-verified. Older reports
          remain unchanged.
        </p>
      )}
      {!complete && (context?.blocking?.length ?? 0) > 0 && (
        <p className="mb-3 text-sm text-slate">
          Incomplete tests:{' '}
          {context?.blocking
            .map((row) => `${row.code} (${row.reason === 'NO_RESULT' ? 'no result' : 'not verified'})`)
            .join(', ')}
        </p>
      )}
      {canGenerate && eligible && (
        <button
          type="button"
          disabled={busy}
          className="mb-4 rounded-md bg-teal px-4 py-2 text-sm text-white"
          onClick={async () => {
            onFailure(null);
            const response = await fetch(`/api/lab-orders/${order.id}/reports`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            const payload = (await response.json()) as Failure & LabOrder;
            if (response.status === 401) {
              window.location.assign('/login');
              return;
            }
            if (!response.ok) {
              onFailure(payload);
              return;
            }
            onSave(payload);
          }}
        >
          {current ? 'Issue new report version' : 'Generate official report'}
        </button>
      )}
      {canGenerate && !eligible && !complete && (
        <p className="mb-4 text-sm text-slate">
          Report generation is unavailable until the order is clinically complete.
        </p>
      )}
      {reports.length === 0 ? (
        <p className="text-sm text-slate">No issued reports yet.</p>
      ) : (
        <div>
          <h3 className="mb-2 text-sm font-medium">Report history</h3>
          <ul className="grid gap-3">
            {reports
              .slice()
              .reverse()
              .map((report) => (
                <ReportHistoryRow
                  key={report.id}
                  report={report}
                  canDownload={canDownload}
                  canDeliver={canDeliver}
                  busy={busy}
                  method={method}
                  recipient={recipient}
                  onMethod={setMethod}
                  onRecipient={setRecipient}
                  onDelivered={setDeliveryMessage}
                  onFailure={onFailure}
                />
              ))}
          </ul>
        </div>
      )}
      {deliveryMessage && (
        <p className="mt-3 text-sm text-teal">{deliveryMessage}</p>
      )}
    </section>
  );
}
function ReportHistoryRow({
  report,
  canDownload,
  canDeliver,
  busy,
  method,
  recipient,
  onMethod,
  onRecipient,
  onDelivered,
  onFailure,
}: {
  report: LabReport;
  canDownload: boolean;
  canDeliver: boolean;
  busy: boolean;
  method: string;
  recipient: string;
  onMethod: (value: string) => void;
  onRecipient: (value: string) => void;
  onDelivered: (value: string) => void;
  onFailure: (failure: Failure | null) => void;
}) {
  return (
    <li className="rounded-md border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono">
            {report.report_number}{' '}
            <span className="font-sans text-slate">v{report.report_version}</span>
          </p>
          <p className="text-xs text-slate">
            {reportStatusLabels[report.status]} · Issued {stampLabel(report.issued_at)} by{' '}
            {report.issued_by_name}
            {report.is_current ? ' · Current' : ' · Previous version'}
          </p>
        </div>
        {canDownload && (
          <a className="text-teal" href={`/api/lab-reports/${report.id}/pdf`}>
            Download PDF
          </a>
        )}
      </div>
      {canDeliver && report.is_current && (
        <form
          className="mt-3 grid gap-2 md:grid-cols-[140px_minmax(140px,1fr)_auto]"
          onSubmit={async (event) => {
            event.preventDefault();
            onFailure(null);
            const response = await fetch(
              `/api/lab-reports/${report.id}/deliver`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  method,
                  recipient_descriptor: recipient,
                }),
              },
            );
            const payload = (await response.json()) as Failure;
            if (response.status === 401) {
              window.location.assign('/login');
              return;
            }
            if (!response.ok) {
              onFailure(payload);
              return;
            }
            onDelivered(`Delivery recorded (${deliveryMethodLabels[method] || method}).`);
            onRecipient('');
          }}
        >
          <label className="text-xs font-medium">
            Delivery method
            <NativeSelect
              className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2"
              value={method}
              onChange={(event) => onMethod(event.target.value)}
            >
              <option value="PRINT">Print</option>
              <option value="MANUAL">Manual</option>
              <option value="DOWNLOAD">Download</option>
            </NativeSelect>
          </label>
          <label className="text-xs font-medium">
            Recipient descriptor
            <Input
              className="mt-1"
              value={recipient}
              onChange={(event) => onRecipient(event.target.value)}
              maxLength={160}
              placeholder="Optional"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="self-end rounded-md border border-teal px-3 py-2 text-teal"
          >
            Record delivery
          </button>
        </form>
      )}
    </li>
  );
}
