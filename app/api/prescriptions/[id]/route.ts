import { database } from '@/lib/db';
import {
  methodNotAllowed,
  prescriptionApi,
  readPrescriptionBody,
} from '@/features/prescriptions/http';
import {
  getPrescription,
  updatePrescription,
} from '@/features/prescriptions/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request, { params }: Context) {
  return prescriptionApi(request, 'prescriptions:read', async (principal) =>
    getPrescription(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return prescriptionApi(request, 'prescriptions:create', async (principal) => {
    const { id } = await params;
    const body = await readPrescriptionBody(request);
    const client = await database().connect();
    try {
      return await updatePrescription(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
