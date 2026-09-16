import { database } from '@/lib/db';
import {
  clinicalApi,
  methodNotAllowed,
  readClinicalBody,
} from '@/features/clinical/http';
import { getBranding, updateBranding } from '@/features/clinical/branding';
export const runtime = 'nodejs';
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request) {
  return clinicalApi(request, 'settings:read', async (principal) =>
    getBranding(database(), principal),
  );
}
export async function PATCH(request: Request) {
  return clinicalApi(request, 'settings:edit', async (principal) => {
    const body = await readClinicalBody(request);
    const client = await database().connect();
    try {
      return await updateBranding(client, principal, body);
    } finally {
      client.release();
    }
  });
}
