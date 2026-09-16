import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { getDoctor, listDoctors } from '@/features/clinical/doctors';
import { getPrescription } from '@/features/clinical/prescriptions';
import { ClinicalError } from '@/features/clinical/types';
import { notFound } from 'next/navigation';

export async function doctorsForPage(principal: Principal, query: unknown = {}) {
  return listDoctors(database(), principal, query);
}

export async function doctorForPage(principal: Principal, id: string) {
  try {
    return await getDoctor(database(), principal, id);
  } catch (error) {
    if (error instanceof ClinicalError && error.status === 404) notFound();
    throw error;
  }
}

export async function prescriptionForPage(principal: Principal, id: string) {
  try {
    return await getPrescription(database(), principal, id);
  } catch (error) {
    if (error instanceof ClinicalError && error.status === 404) notFound();
    throw error;
  }
}
