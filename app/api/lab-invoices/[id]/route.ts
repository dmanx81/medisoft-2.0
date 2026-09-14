import { database } from '@/lib/db';
import { billingApi, methodNotAllowed, readBillingBody } from '@/features/billing/http';
import { getInvoice, updateInvoice } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET, PATCH');
}
export async function GET(request: Request, { params }: Context) {
  return billingApi(request, 'billing:read', async (principal) =>
    getInvoice(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return billingApi(request, 'billing:create', async (principal) => {
    const { id } = await params;
    const body = await readBillingBody(request);
    const client = await database().connect();
    try {
      return await updateInvoice(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
