import 'server-only';
import { notFound } from 'next/navigation';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { getPatient } from '@/features/patients/repository';
import { PatientError, type PatientSummary } from '@/features/patients/types';
export async function patientForPage(principal: Principal, id: string) {
  try {
    return await getPatient(database(), principal, id);
  } catch (error) {
    if (error instanceof PatientError && error.status === 404) notFound();
    throw error;
  }
}
export async function optionalActivePatient(
  principal: Principal,
  id: string | undefined,
): Promise<PatientSummary | null> {
  if (!id) return null;
  try {
    const patient = await getPatient(database(), principal, id);
    if (patient.status !== 'ACTIVE') return null;
    return {
      id: patient.id,
      patient_number: patient.patient_number,
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      phone: patient.phone,
      email: patient.email,
      status: patient.status,
      updated_at: patient.updated_at,
    };
  } catch (error) {
    if (
      error instanceof PatientError &&
      (error.status === 404 || error.status === 403)
    )
      return null;
    throw error;
  }
}
