import { database } from '@/lib/db';
import { billingPdfApi } from '@/features/billing/http';
import { downloadPaymentReceipt } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return billingPdfApi(request, 'billing:read', async (principal) => {
    const client = await database().connect();
    try {
      return await downloadPaymentReceipt(
        client,
        principal,
        (await params).id,
      );
    } finally {
      client.release();
    }
  });
}
