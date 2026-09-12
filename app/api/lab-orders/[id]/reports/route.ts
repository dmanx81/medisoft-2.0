import { database } from '@/lib/db';
import { reportApi, readReportBody } from '@/features/reports/http';
import {
  generateReport,
  listOrderReports,
} from '@/features/reports/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: 'GET, POST',
      'Cache-Control': 'private, no-store',
    },
  });
}
export async function GET(request: Request, { params }: Context) {
  return reportApi(request, 'reports:read', async (principal) =>
    listOrderReports(database(), principal, (await params).id),
  );
}
export async function POST(request: Request, { params }: Context) {
  return reportApi(request, 'reports:generate', async (principal) => {
    const { id } = await params;
    const body = await readReportBody(request);
    const client = await database().connect();
    try {
      return await generateReport(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
