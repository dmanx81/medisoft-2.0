import 'server-only';
import { notFound } from 'next/navigation';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { getDoctor } from '@/features/doctors/repository';
import { DoctorError } from '@/features/doctors/types';
export async function doctorForPage(principal: Principal, id: string) {
  try {
    return await getDoctor(database(), principal, id);
  } catch (error) {
    if (error instanceof DoctorError && error.status === 404) notFound();
    throw error;
  }
}
