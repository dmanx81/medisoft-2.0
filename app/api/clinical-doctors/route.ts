import { database } from '@/lib/db';
import {
  clinicalApi,
  methodNotAllowed,
  readClinicalBody,
} from '@/features/clinical/http';
import { createDoctor, listDoctors } from '@/features/clinical/doctors';
export const runtime = 'nodejs';
export function DELETE() {
  return methodNotAllowed('GET, POST');
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  return clinicalApi(request, 'doctors:read', async (principal) =>
    listDoctors(database(), principal, {
      query: url.searchParams.get('query') ?? '',
      status: url.searchParams.get('status') || 'ALL',
      page: Number(url.searchParams.get('page') || '1'),
    }),
  );
}
export async function POST(request: Request) {
  return clinicalApi(request, 'doctors:manage', async (principal) => {
    const body = await readClinicalBody(request);
    const client = await database().connect();
    try {
      return await createDoctor(client, principal, body);
    } finally {
      client.release();
    }
  });
}
