import { database } from '@/lib/db';
import { billingApi, readBillingBody } from '@/features/billing/http';
import { listInvoiceWork } from '@/features/billing/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return billingApi(request, 'billing:read', async (principal) =>
    listInvoiceWork(database(), principal, await readBillingBody(request)),
  );
}
