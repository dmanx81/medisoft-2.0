'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { ClinicalPrescription } from '@/features/clinical/types';
import { prescriptionStatusLabels } from '@/features/clinical/format';
type Failure = { message?: string };
export function PrescriptionDetail({
  prescription,
  canFinalize,
  canCancel,
  canCreate,
  canDownload,
}: {
  prescription: ClinicalPrescription;
  canFinalize: boolean;
  canCancel: boolean;
  canCreate: boolean;
  canDownload: boolean;
}) {
  const [current, setCurrent] = useState(prescription);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setFailure('');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const payload = (await response.json()) as Failure & ClinicalPrescription;
      if (!response.ok) {
        setFailure(payload.message || 'The prescription could not be updated.');
        return;
      }
      setCurrent(payload);
    } finally {
      setBusy(false);
    }
  }
  const pdfHref = `/api/clinical-prescriptions/${current.id}/pdf`;
  return (
    <section className="mx-auto grid max-w-4xl gap-5">
      <div>
        <p className="text-sm text-teal">Prescription</p>
        <h1 className="mt-1 text-2xl font-semibold">
          {current.prescription_number || 'Draft prescription'}
        </h1>
        <p className="mt-2 text-sm text-slate">
          {current.patient_display} · {current.patient_number} ·{' '}
          {prescriptionStatusLabels[current.status]}
        </p>
      </div>
      {failure && (
        <p className="rounded-md border border-coral/30 p-3 text-sm text-coral" role="alert">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canCreate && current.status === 'DRAFT' && (
          <Link
            href={`/app/prescriptions/${current.id}/edit`}
            className="rounded-md border border-line px-3 py-1.5 text-sm"
          >
            Edit draft
          </Link>
        )}
        {canFinalize && current.status === 'DRAFT' && (
          <button
            type="button"
            className="rounded-md bg-teal px-3 py-1.5 text-sm font-medium text-white"
            disabled={busy}
            onClick={() =>
              void act(`/api/clinical-prescriptions/${current.id}/finalize`, {
                version: current.version,
              })
            }
          >
            Finalize / sign
          </button>
        )}
        {canDownload && current.status !== 'DRAFT' && current.prescription_number && (
          <>
            <a className="rounded-md border border-line px-3 py-1.5 text-sm" href={pdfHref} target="_blank" rel="noreferrer">
              Preview
            </a>
            <a className="rounded-md border border-line px-3 py-1.5 text-sm" href={pdfHref} target="_blank" rel="noreferrer">
              Print
            </a>
            <a
              className="rounded-md border border-line px-3 py-1.5 text-sm"
              href={pdfHref}
              download={`${current.prescription_number}.pdf`}
            >
              Download PDF
            </a>
          </>
        )}
      </div>
      <section className="rounded-md border border-line bg-white p-5">
        <h2 className="font-semibold">Doctor</h2>
        <p className="mt-2 text-sm">{current.doctor_display}</p>
        <p className="mt-1 text-sm text-slate">Date {current.prescribed_on}</p>
        {current.clinical_note && (
          <p className="mt-3 whitespace-pre-wrap text-sm">{current.clinical_note}</p>
        )}
      </section>
      <section className="rounded-md border border-line bg-white p-5">
        <h2 className="font-semibold">Medications</h2>
        <ol className="mt-3 grid gap-3 text-sm">
          {current.items.map((item) => (
            <li key={item.id}>
              <p className="font-medium">{item.medication_name}</p>
              <p className="text-slate">
                {[item.strength, item.form, item.dose, item.route, item.frequency, item.duration, item.quantity]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {item.instructions && <p>{item.instructions}</p>}
            </li>
          ))}
          {current.items.length === 0 && (
            <li className="text-slate">No medications on this draft yet.</li>
          )}
        </ol>
        {current.instructions && (
          <p className="mt-4 whitespace-pre-wrap text-sm">{current.instructions}</p>
        )}
      </section>
      {canCancel && current.status !== 'CANCELLED' && (
        <form
          className="grid gap-3 rounded-md border border-line bg-white p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void act(`/api/clinical-prescriptions/${current.id}/cancel`, {
              reason,
              version: current.version,
            });
          }}
        >
          <label className="text-sm font-medium" htmlFor="rx-cancel-reason">
            Cancel / revoke
            <textarea
              id="rx-cancel-reason"
              className="mt-2 w-full rounded-md border border-line p-2 text-sm"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="w-fit rounded-md border border-coral px-3 py-1.5 text-sm text-coral"
            disabled={busy}
          >
            Cancel prescription
          </button>
        </form>
      )}
      <Link href={`/app/patients/${current.patient_id}`} className="text-sm text-teal">
        ← Patient record
      </Link>
    </section>
  );
}
