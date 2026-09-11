import { database } from '@/lib/db';
import { resultApi } from '@/features/results/http';
import { getResultContext } from '@/features/results/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; testId: string }> };
export async function GET(request: Request, { params }: Context) {
  return resultApi(request, 'results:read', async (principal) => {
    const { id, testId } = await params;
    return getResultContext(database(), principal, id, testId);
  });
}
