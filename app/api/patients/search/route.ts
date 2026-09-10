import { database } from '@/lib/db';
import { patientApi, readPatientBody } from '@/features/patients/http';
import { listPatients } from '@/features/patients/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return patientApi(request, 'patients:read', async (principal) =>
    listPatients(database(), principal, await readPatientBody(request)),
  );
}
