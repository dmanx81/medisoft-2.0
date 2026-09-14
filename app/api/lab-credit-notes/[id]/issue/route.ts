import { database } from '@/lib/db';
import { billingApi, readBillingBody } from '@/features/billing/http';
import { issueCreditNote } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  return billingApi(request, 'billing:correct', async (principal) => {
    const { id } = await params;
    const body = await readBillingBody(request);
    const client = await database().connect();
    try {
      return await issueCreditNote(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
