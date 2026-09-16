'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PrescriptionPage } from '@/features/clinical/types';
import { prescriptionStatusLabels } from '@/features/clinical/format';
export function PatientPrescriptions({
  patientId,
  canCreate,
}: {
  patientId: string;
  canCreate: boolean;
}) {
  const [result, setResult] = useState<PrescriptionPage | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/clinical-prescriptions/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient_id: patientId, pageSize: 20 }),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('unavailable');
        const data = (await response.json()) as PrescriptionPage;
        if (!cancelled) setResult(data);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Prescriptions</h2>
        {canCreate && (
          <Link
            href={`/app/patients/${patientId}/prescriptions/new`}
            prefetch={false}
            className="rounded-md bg-teal px-3 py-1.5 text-sm font-medium text-white"
          >
            New prescription
          </Link>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      {result && result.prescriptions.length === 0 && (
        <p className="mt-3 text-sm text-slate">No prescriptions for this patient.</p>
      )}
      {result && result.prescriptions.length > 0 && (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Doctor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Medications</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.prescriptions.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.prescribed_on}</TableCell>
                <TableCell className="font-mono text-xs">
                  {item.prescription_number || 'Draft'}
                </TableCell>
                <TableCell>{item.doctor_display}</TableCell>
                <TableCell>{prescriptionStatusLabels[item.status]}</TableCell>
                <TableCell>{item.medication_summary}</TableCell>
                <TableCell>
                  <Link className="text-teal" href={`/app/prescriptions/${item.id}`}>
                    View
                  </Link>
                  {item.status === 'DRAFT' && canCreate && (
                    <>
                      {' · '}
                      <Link
                        className="text-teal"
                        href={`/app/prescriptions/${item.id}/edit`}
                      >
                        Edit draft
                      </Link>
                    </>
                  )}
                  {item.status !== 'DRAFT' && item.prescription_number && (
                    <>
                      {' · '}
                      <a
                        className="text-teal"
                        href={`/api/clinical-prescriptions/${item.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Print
                      </a>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
