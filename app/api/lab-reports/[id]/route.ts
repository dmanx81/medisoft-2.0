import { database } from '@/lib/db';
import { reportApi } from '@/features/reports/http';
import { getReport } from '@/features/reports/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function DELETE() {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: 'GET',
      'Cache-Control': 'private, no-store',
    },
  });
}
export async function GET(request: Request, { params }: Context) {
  return reportApi(request, 'reports:read', async (principal) =>
    getReport(database(), principal, (await params).id),
  );
}
