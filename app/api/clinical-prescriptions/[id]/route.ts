import { database } from '@/lib/db';
import {
  clinicalApi,
  methodNotAllowed,
  readClinicalBody,
} from '@/features/clinical/http';
import {
  getPrescription,
  updatePrescription,
} from '@/features/clinical/prescriptions';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request, { params }: Context) {
  return clinicalApi(request, 'prescriptions:read', async (principal) =>
    getPrescription(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return clinicalApi(request, 'prescriptions:create', async (principal) => {
    const body = await readClinicalBody(request);
    const client = await database().connect();
    try {
      return await updatePrescription(client, principal, (await params).id, body);
    } finally {
      client.release();
    }
  });
}
