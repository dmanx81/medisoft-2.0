import { database } from '@/lib/db';
import { reportApi } from '@/features/reports/http';
import { getReportContext } from '@/features/reports/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return reportApi(request, 'reports:read', async (principal) =>
    getReportContext(database(), principal, (await params).id),
  );
}
