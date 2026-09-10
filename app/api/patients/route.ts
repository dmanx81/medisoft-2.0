import { database } from '@/lib/db';
import { patientApi, readPatientBody } from '@/features/patients/http';
import { createPatient } from '@/features/patients/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return patientApi(request, 'patients:create', async (principal) => {
    const body = await readPatientBody(request);
    const client = await database().connect();
    try {
      return await createPatient(client, principal, body);
    } finally {
      client.release();
    }
  });
}
