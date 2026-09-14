import { database } from '@/lib/db';
import { environment } from '@/lib/env';
import { reportApi, readReportBody } from '@/features/reports/http';
import {
  createReportShare,
  listReportShares,
} from '@/features/reports/shares';
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
  return reportApi(request, 'reports:share', async (principal) =>
    listReportShares(database(), principal, (await params).id),
  );
}
export async function POST(request: Request, { params }: Context) {
  return reportApi(request, 'reports:share', async (principal) => {
    const { id } = await params;
    const body = await readReportBody(request);
    const client = await database().connect();
    try {
      return await createReportShare(
        client,
        principal,
        id,
        body,
        environment().APP_ORIGIN,
      );
    } finally {
      client.release();
    }
  });
}
