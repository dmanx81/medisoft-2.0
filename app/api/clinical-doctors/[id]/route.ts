import { database } from '@/lib/db';
import {
  clinicalApi,
  methodNotAllowed,
  readClinicalBody,
} from '@/features/clinical/http';
import { getDoctor, updateDoctor } from '@/features/clinical/doctors';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request, { params }: Context) {
  return clinicalApi(request, 'doctors:read', async (principal) =>
    getDoctor(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return clinicalApi(request, 'doctors:manage', async (principal) => {
    const body = await readClinicalBody(request);
    const client = await database().connect();
    try {
      return await updateDoctor(client, principal, (await params).id, body);
    } finally {
      client.release();
    }
  });
}
