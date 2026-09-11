import { database } from '@/lib/db';
import { resultApi, readResultBody } from '@/features/results/http';
import { verifyResult } from '@/features/results/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  return resultApi(request, 'results:verify', async (principal) => {
    const { id } = await params;
    const body = await readResultBody(request);
    const client = await database().connect();
    try {
      return await verifyResult(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
