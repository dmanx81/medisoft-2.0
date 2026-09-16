'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import type { Prescription } from '@/features/prescriptions/types';
import { prescriptionStatusLabels } from '@/features/prescriptions/format';
import { dateLabel } from '@/features/patients/format';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function PrescriptionDetail({
  initial,
  canFinalize,
  canCancel,
  canEditDraft,
  canDownload,
}: {
  initial: Prescription;
  canFinalize: boolean;
  canCancel: boolean;
  canEditDraft: boolean;
  canDownload: boolean;
}) {
  const [prescription, setPrescription] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reason, setReason] = useState('');
  const pdfHref = `/api/prescriptions/${prescription.id}/pdf`;
  async function act(path: string, body: unknown) {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const payload = (await response.json()) as Failure & Prescription;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      setPrescription(payload);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/app/patients/${prescription.patient_id}`} className="text-sm text-teal">
        ← Patient record
      </Link>
      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-semibold">
            {prescription.prescription_number || 'Draft prescription'}
          </h1>
          <p className="mt-2 text-sm text-slate">
            {prescriptionStatusLabels[prescription.status]} ·{' '}
            {dateLabel(prescription.prescription_date)} · {prescription.doctor_display_name}
          </p>
          <p className="mt-1 text-sm">
            {prescription.patient_last_name}, {prescription.patient_first_name}{' '}
            <span className="font-mono text-xs text-slate">{prescription.patient_number}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditDraft && prescription.status === 'DRAFT' && (
            <Link
              className="rounded-md border border-line px-4 py-2 text-sm"
              href={`/app/prescriptions/${prescription.id}/edit`}
            >
              Edit draft
            </Link>
          )}
          {canDownload && (
            <>
              <a
                className="rounded-md border border-line px-4 py-2 text-sm"
                href={`${pdfHref}?mode=preview`}
                target="_blank"
                rel="noreferrer"
              >
                Preview
              </a>
              <a
                className="rounded-md border border-line px-4 py-2 text-sm"
                href={`${pdfHref}?mode=preview`}
                target="_blank"
                rel="noreferrer"
              >
                Print
              </a>
              <a
                className="rounded-md bg-teal px-4 py-2 text-sm text-white"
                href={`${pdfHref}?mode=download`}
              >
                Download PDF
              </a>
            </>
          )}
        </div>
      </header>
      {failure && (
        <p className="mb-4 rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {failure.message || 'The prescription action could not be completed.'}
        </p>
      )}
      {prescription.clinical_note && (
        <section className="mb-4 rounded-md border border-line bg-white p-5">
          <h2 className="mb-2 font-semibold">Clinical note</h2>
          <p className="whitespace-pre-wrap text-sm">{prescription.clinical_note}</p>
        </section>
      )}
      <section className="mb-4 rounded-md border border-line bg-white p-5">
        <h2 className="mb-3 font-semibold">Medications</h2>
        <ol className="grid gap-4">
          {prescription.items.map((item) => (
            <li key={item.id} className="text-sm">
              <p className="font-medium">{item.medication_name}</p>
              <p className="mt-1 text-slate">
                {[
                  item.strength,
                  item.form,
                  item.dose,
                  item.route,
                  item.frequency,
                  item.duration,
                  item.quantity,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {item.instructions && <p className="mt-1">{item.instructions}</p>}
            </li>
          ))}
        </ol>
        {prescription.general_instructions && (
          <p className="mt-4 whitespace-pre-wrap text-sm">
            {prescription.general_instructions}
          </p>
        )}
      </section>
      {canFinalize && prescription.status === 'DRAFT' && (
        <button
          type="button"
          disabled={busy}
          className="mr-3 rounded-md bg-teal px-4 py-2 text-sm text-white"
          onClick={() =>
            void act(`/api/prescriptions/${prescription.id}/finalize`, {
              version: prescription.version,
            })
          }
        >
          Finalize / sign
        </button>
      )}
      {canCancel && prescription.status !== 'CANCELLED' && (
        <form
          className="mt-6 grid max-w-lg gap-3 rounded-md border border-line bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void act(`/api/prescriptions/${prescription.id}/cancel`, {
              reason,
              version: prescription.version,
            });
          }}
        >
          <label className="text-sm font-medium" htmlFor="rx-cancel">
            Cancellation / revocation reason
            <Input
              id="rx-cancel"
              className="mt-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md border border-coral px-4 py-2 text-sm text-coral"
          >
            Cancel prescription
          </button>
        </form>
      )}
    </div>
  );
}
