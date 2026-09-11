import { database } from '@/lib/db';
import { orderApi, readOrderBody } from '@/features/orders/http';
import { createSpecimen } from '@/features/orders/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  return orderApi(request, 'samples:collect', async (principal) => {
    const { id } = await params;
    const body = await readOrderBody(request);
    const client = await database().connect();
    try {
      return await createSpecimen(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
