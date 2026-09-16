import { database } from '@/lib/db';
import { clinicalApi, methodNotAllowed } from '@/features/clinical/http';
import { listStaffLookups } from '@/features/clinical/doctors';
export const runtime = 'nodejs';
export function DELETE() {
  return methodNotAllowed('GET');
}
export async function GET(request: Request) {
  return clinicalApi(request, 'doctors:manage', async (principal) =>
    listStaffLookups(database(), principal),
  );
}
