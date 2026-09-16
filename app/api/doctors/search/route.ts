import { database } from '@/lib/db';
import { doctorApi, methodNotAllowed, readDoctorBody } from '@/features/doctors/http';
import { listDoctors } from '@/features/doctors/repository';
export const runtime = 'nodejs';
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request) {
  return doctorApi(request, 'doctors:read', async (principal) => {
    const body = await readDoctorBody(request);
    return listDoctors(database(), principal, body);
  });
}
