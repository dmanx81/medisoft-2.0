import { database } from '@/lib/db';
import { resultApi } from '@/features/results/http';
import { listResultHistory } from '@/features/results/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return resultApi(request, 'results:read', async (principal) =>
    listResultHistory(database(), principal, (await params).id),
  );
}
