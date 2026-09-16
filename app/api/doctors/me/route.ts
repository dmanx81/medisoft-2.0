import { database } from '@/lib/db';
import { doctorApi, methodNotAllowed } from '@/features/doctors/http';
import { getDoctorByUser } from '@/features/doctors/repository';
export const runtime = 'nodejs';
export function POST() {
  return methodNotAllowed('GET');
}
export function DELETE() {
  return methodNotAllowed('GET');
}
export async function GET(request: Request) {
  return doctorApi(request, 'doctors:read', async (principal) => {
    const doctor = await getDoctorByUser(database(), principal);
    if (!doctor)
      return { doctor: null };
    return doctor;
  });
}
