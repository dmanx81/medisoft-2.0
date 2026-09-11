import { database } from '@/lib/db';
import { resultApi, readResultBody } from '@/features/results/http';
import { enterResult } from '@/features/results/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; testId: string }> };
export async function POST(request: Request, { params }: Context) {
  return resultApi(request, 'results:enter', async (principal) => {
    const { id, testId } = await params;
    const body = await readResultBody(request);
    const client = await database().connect();
    try {
      return await enterResult(client, principal, id, testId, body);
    } finally {
      client.release();
    }
  });
}
