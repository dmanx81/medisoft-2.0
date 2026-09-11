import { database } from '@/lib/db';
import { resultApi, readResultBody } from '@/features/results/http';
import { listResultWork } from '@/features/results/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return resultApi(request, 'results:read', async (principal) =>
    listResultWork(database(), principal, await readResultBody(request)),
  );
}
