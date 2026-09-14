import { database } from '@/lib/db';
import { billingApi } from '@/features/billing/http';
import { listInvoiceDeliveries } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return billingApi(request, 'billing:read', async (principal) =>
    listInvoiceDeliveries(database(), principal, (await params).id),
  );
}
