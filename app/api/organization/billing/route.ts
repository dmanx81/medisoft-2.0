import { database } from '@/lib/db';
import { billingApi, methodNotAllowed, readBillingBody } from '@/features/billing/http';
import {
  getBillingSettings,
  updateBillingSettings,
} from '@/features/billing/repository';
export const runtime = 'nodejs';
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request) {
  return billingApi(request, 'billing:read', async (principal) =>
    getBillingSettings(database(), principal),
  );
}
export async function PATCH(request: Request) {
  return billingApi(request, 'billing:settings', async (principal) => {
    const body = await readBillingBody(request);
    const client = await database().connect();
    try {
      return await updateBillingSettings(client, principal, body);
    } finally {
      client.release();
    }
  });
}
