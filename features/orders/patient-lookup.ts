import type { PatientSummary } from '@/features/patients/types';
import type { OrderInput } from './validation';

export const patientSearchBody = (query: string) => ({
  query,
  status: 'ACTIVE' as const,
  pageSize: 10,
});

export function patientsFromSearchResponse(data: unknown): PatientSummary[] {
  if (!data || typeof data !== 'object' || !('patients' in data)) return [];
  const patients = (data as { patients: unknown }).patients;
  return Array.isArray(patients) ? patients : [];
}

export function labOrderSubmitBody(
  patient: Pick<PatientSummary, 'id'> | null,
  fields: Omit<OrderInput, 'patient_id'>,
  testIds: string[],
  place: boolean,
) {
  return {
    data: {
      patient_id: patient?.id ?? '',
      ...fields,
      test_ids: testIds,
    },
    place,
  };
}
