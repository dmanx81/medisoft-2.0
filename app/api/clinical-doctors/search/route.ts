import { database } from '@/lib/db';
import { clinicalApi, methodNotAllowed, readClinicalBody } from '@/features/clinical/http';
import { listDoctors } from '@/features/clinical/doctors';
export const runtime = 'nodejs';
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request) {
  return clinicalApi(request, 'doctors:read', async (principal) =>
    listDoctors(database(), principal, await readClinicalBody(request)),
  );
}
