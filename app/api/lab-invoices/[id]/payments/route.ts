import { database } from '@/lib/db';
import { billingApi, methodNotAllowed, readBillingBody } from '@/features/billing/http';
import {
  listInvoicePayments,
  recordPayment,
} from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return methodNotAllowed('GET, POST');
}
export async function GET(request: Request, { params }: Context) {
  return billingApi(request, 'billing:read', async (principal) =>
    listInvoicePayments(database(), principal, (await params).id),
  );
}
export async function POST(request: Request, { params }: Context) {
  return billingApi(request, 'billing:payment-record', async (principal) => {
    const { id } = await params;
    const body = await readBillingBody(request);
    const client = await database().connect();
    try {
      return await recordPayment(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
