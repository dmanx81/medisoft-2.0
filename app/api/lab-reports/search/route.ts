import { database } from '@/lib/db';
import { reportApi, readReportBody } from '@/features/reports/http';
import { listReportWork } from '@/features/reports/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return reportApi(request, 'reports:read', async (principal) =>
    listReportWork(database(), principal, await readReportBody(request)),
  );
}
