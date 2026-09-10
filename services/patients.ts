import 'server-only';
import { notFound } from 'next/navigation';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { getPatient } from '@/features/patients/repository';
import { PatientError } from '@/features/patients/types';
export async function patientForPage(principal: Principal, id: string) {
  try {
    return await getPatient(database(), principal, id);
  } catch (error) {
    if (error instanceof PatientError && error.status === 404) notFound();
    throw error;
  }
}
