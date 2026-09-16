import { database } from '@/lib/db';
import { clinicalApi, methodNotAllowed, readClinicalBody } from '@/features/clinical/http';
import { listPrescriptions } from '@/features/clinical/prescriptions';
export const runtime = 'nodejs';
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request) {
  return clinicalApi(request, 'prescriptions:read', async (principal) =>
    listPrescriptions(database(), principal, await readClinicalBody(request)),
  );
}
