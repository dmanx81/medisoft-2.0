import { database } from '@/lib/db';
import { billingPdfApi } from '@/features/billing/http';
import { downloadInvoicePdf } from '@/features/billing/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return billingPdfApi(request, 'billing:read', async (principal) => {
    const client = await database().connect();
    try {
      const { pdf, filename } = await downloadInvoicePdf(
        client,
        principal,
        (await params).id,
      );
      return { pdf, filename };
    } finally {
      client.release();
    }
  });
}
