import { database } from '@/lib/db';
import { doctorApi, methodNotAllowed, readDoctorBody } from '@/features/doctors/http';
import { createDoctor, listDoctors } from '@/features/doctors/repository';
export const runtime = 'nodejs';
export function DELETE() {
  return methodNotAllowed('GET, POST');
}
export async function GET(request: Request) {
  return doctorApi(request, 'doctors:read', async (principal) =>
    listDoctors(database(), principal, {}),
  );
}
export async function POST(request: Request) {
  return doctorApi(request, 'doctors:manage', async (principal) => {
    const body = await readDoctorBody(request);
    const client = await database().connect();
    try {
      return await createDoctor(client, principal, body);
    } finally {
      client.release();
    }
  });
}
