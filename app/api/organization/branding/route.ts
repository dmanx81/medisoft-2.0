import { database } from '@/lib/db';
import {
  brandingApi,
  methodNotAllowed,
  readBrandingBody,
} from '@/features/branding/http';
import { getBranding, updateBranding } from '@/features/branding/repository';
export const runtime = 'nodejs';
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request) {
  return brandingApi(request, 'settings:read', async (principal) =>
    getBranding(database(), principal),
  );
}
export async function PATCH(request: Request) {
  return brandingApi(request, 'settings:edit', async (principal) => {
    const body = await readBrandingBody(request);
    const client = await database().connect();
    try {
      return await updateBranding(client, principal, body);
    } finally {
      client.release();
    }
  });
}
