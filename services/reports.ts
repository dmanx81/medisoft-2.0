import 'server-only';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { listReportWork } from '@/features/reports/repository';
export async function reportsForPage(
  principal: Principal,
  input: unknown = {},
) {
  return listReportWork(database(), principal, input);
}
