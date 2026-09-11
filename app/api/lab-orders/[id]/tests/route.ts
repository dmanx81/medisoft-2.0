import { database } from '@/lib/db';
import { attachResults, orderApi, readOrderBody } from '@/features/orders/http';
import { addOrderTests } from '@/features/orders/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  return orderApi(request, 'orders:edit', async (principal) => {
    const { id } = await params;
    const body = await readOrderBody(request);
    const client = await database().connect();
    try {
      return await attachResults(
        client,
        principal,
        await addOrderTests(client, principal, id, body),
      );
    } finally {
      client.release();
    }
  });
}
