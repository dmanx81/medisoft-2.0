import { database } from '@/lib/db';
import { patientApi, readPatientBody } from '@/features/patients/http';
import { getPatient, updatePatient } from '@/features/patients/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return patientApi(request, 'patients:read', async (principal) =>
    getPatient(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return patientApi(request, 'patients:edit', async (principal) => {
    const { id } = await params;
    const body = await readPatientBody(request);
    const client = await database().connect();
    try {
      return await updatePatient(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
