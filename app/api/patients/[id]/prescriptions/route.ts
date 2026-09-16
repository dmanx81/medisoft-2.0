import { database } from '@/lib/db';
import {
  methodNotAllowed,
  prescriptionApi,
  readPrescriptionBody,
} from '@/features/prescriptions/http';
import {
  createPrescription,
  listPrescriptions,
} from '@/features/prescriptions/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET, POST');
}
export async function GET(request: Request, { params }: Context) {
  return prescriptionApi(request, 'prescriptions:read', async (principal) =>
    listPrescriptions(database(), principal, {
      patient_id: (await params).id,
      pageSize: 50,
    }),
  );
}
export async function POST(request: Request, { params }: Context) {
  return prescriptionApi(request, 'prescriptions:create', async (principal) => {
    const body = (await readPrescriptionBody(request)) as Record<string, unknown>;
    const client = await database().connect();
    try {
      return await createPrescription(client, principal, {
        ...body,
        patient_id: (await params).id,
      });
    } finally {
      client.release();
    }
  });
}
