import 'server-only';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import { listResultWork } from '@/features/results/repository';
export async function resultWorkForPage(
  principal: Principal,
  input: unknown = {},
) {
  return listResultWork(database(), principal, input);
}
