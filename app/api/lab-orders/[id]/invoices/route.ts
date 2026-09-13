import { database } from '@/lib/db';
import { billingApi, methodNotAllowed, readBillingBody } from '@/features/billing/http';
import { createInvoice } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('POST');
}
export async function POST(request: Request, { params }: Context) {
  return billingApi(request, 'billing:create', async (principal) => {
    const { id } = await params;
    const body = await readBillingBody(request);
    const client = await database().connect();
    try {
      return await createInvoice(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
