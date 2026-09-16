'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PrescriptionSummary } from '@/features/prescriptions/types';
import { prescriptionStatusLabels } from '@/features/prescriptions/format';
import { dateLabel } from '@/features/patients/format';
export function PatientPrescriptions({
  patientId,
  canCreate,
}: {
  patientId: string;
  canCreate: boolean;
}) {
  const [items, setItems] = useState<PrescriptionSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/patients/${patientId}/prescriptions`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('unavailable');
        const data = (await response.json()) as { prescriptions: PrescriptionSummary[] };
        if (!cancelled) setItems(data.prescriptions);
      } catch {
        if (!cancelled) setError('Prescriptions could not be loaded.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);
  return (
    <div className="rounded-md border border-line bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">Prescriptions</h2>
        {canCreate && (
          <Link
            className="text-sm text-teal"
            href={`/app/patients/${patientId}/prescriptions/new`}
          >
            New prescription
          </Link>
        )}
      </div>
      <p className="text-sm text-slate">
        Finalized prescriptions remain available as frozen clinical documents.
      </p>
      {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      {items && items.length === 0 && (
        <p className="mt-3 text-sm text-slate">No prescriptions for this patient.</p>
      )}
      {items && items.length > 0 && (
        <ul className="mt-3 divide-y divide-line text-sm">
          {items.map((prescription) => (
            <li key={prescription.id} className="flex flex-wrap justify-between gap-2 py-2">
              <Link className="font-mono text-teal" href={`/app/prescriptions/${prescription.id}`}>
                {prescription.prescription_number || 'Draft'}
              </Link>
              <span>
                {dateLabel(prescription.prescription_date)} · {prescription.doctor_display_name} ·{' '}
                {prescriptionStatusLabels[prescription.status]}
                {prescription.medication_summary
                  ? ` · ${prescription.medication_summary}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
