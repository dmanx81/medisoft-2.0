import { database } from '@/lib/db';
import {
  methodNotAllowed,
  prescriptionApi,
  readPrescriptionBody,
} from '@/features/prescriptions/http';
import { finalizePrescription } from '@/features/prescriptions/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function GET() {
  return methodNotAllowed('POST');
}
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request, { params }: Context) {
  return prescriptionApi(request, 'prescriptions:finalize', async (principal) => {
    const body = await readPrescriptionBody(request);
    const client = await database().connect();
    try {
      return await finalizePrescription(
        client,
        principal,
        (await params).id,
        body,
      );
    } finally {
      client.release();
    }
  });
}
