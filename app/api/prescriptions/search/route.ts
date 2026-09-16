import { database } from '@/lib/db';
import {
  methodNotAllowed,
  prescriptionApi,
  readPrescriptionBody,
} from '@/features/prescriptions/http';
import { listPrescriptions } from '@/features/prescriptions/repository';
export const runtime = 'nodejs';
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request) {
  return prescriptionApi(request, 'prescriptions:read', async (principal) => {
    const body = await readPrescriptionBody(request);
    return listPrescriptions(database(), principal, body);
  });
}
