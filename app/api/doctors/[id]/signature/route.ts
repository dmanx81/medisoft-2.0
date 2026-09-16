import { database } from '@/lib/db';
import { doctorApi, methodNotAllowed } from '@/features/doctors/http';
import { readImageUpload } from '@/features/branding/http';
import {
  clearDoctorSignature,
  upsertDoctorSignature,
} from '@/features/doctors/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET() {
  return methodNotAllowed('POST, DELETE');
}
export async function POST(request: Request, { params }: Context) {
  return doctorApi(request, 'doctors:manage', async (principal) => {
    const upload = await readImageUpload(request);
    const client = await database().connect();
    try {
      return await upsertDoctorSignature(
        client,
        principal,
        (await params).id,
        upload,
      );
    } finally {
      client.release();
    }
  });
}
export async function DELETE(request: Request, { params }: Context) {
  return doctorApi(request, 'doctors:manage', async (principal) => {
    const client = await database().connect();
    try {
      return await clearDoctorSignature(client, principal, (await params).id);
    } finally {
      client.release();
    }
  });
}
