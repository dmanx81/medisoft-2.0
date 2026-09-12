import { database } from '@/lib/db';
import { reportApi, readReportBody } from '@/features/reports/http';
import { recordReportDelivery } from '@/features/reports/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  return reportApi(request, 'reports:deliver', async (principal) => {
    const { id } = await params;
    const body = await readReportBody(request);
    const client = await database().connect();
    try {
      return await recordReportDelivery(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
