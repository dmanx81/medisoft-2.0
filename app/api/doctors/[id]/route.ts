import { database } from '@/lib/db';
import { doctorApi, methodNotAllowed, readDoctorBody } from '@/features/doctors/http';
import { getDoctor, updateDoctor } from '@/features/doctors/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request, { params }: Context) {
  return doctorApi(request, 'doctors:read', async (principal) =>
    getDoctor(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return doctorApi(request, 'doctors:manage', async (principal) => {
    const { id } = await params;
    const body = await readDoctorBody(request);
    const client = await database().connect();
    try {
      return await updateDoctor(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
