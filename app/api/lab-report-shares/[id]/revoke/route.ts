import { database } from '@/lib/db';
import { reportApi } from '@/features/reports/http';
import { revokeReportShare } from '@/features/reports/shares';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: 'POST',
      'Cache-Control': 'private, no-store',
    },
  });
}
export async function POST(request: Request, { params }: Context) {
  return reportApi(request, 'reports:share-revoke', async (principal) => {
    const client = await database().connect();
    try {
      return await revokeReportShare(client, principal, (await params).id);
    } finally {
      client.release();
    }
  });
}
