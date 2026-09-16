import 'server-only';
import { notFound } from 'next/navigation';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { getPrescription } from '@/features/prescriptions/repository';
import { PrescriptionError } from '@/features/prescriptions/types';
export async function prescriptionForPage(principal: Principal, id: string) {
  try {
    return await getPrescription(database(), principal, id);
  } catch (error) {
    if (error instanceof PrescriptionError && error.status === 404) notFound();
    throw error;
  }
}
