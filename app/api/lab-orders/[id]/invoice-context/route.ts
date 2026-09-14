import { database } from '@/lib/db';
import { billingApi } from '@/features/billing/http';
import { getInvoiceContext } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return billingApi(request, 'billing:read', async (principal) =>
    getInvoiceContext(database(), principal, (await params).id),
  );
}
