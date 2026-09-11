import { database } from '@/lib/db';
import { orderApi, readOrderBody } from '@/features/orders/http';
import { removeOrderTest } from '@/features/orders/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; testId: string }> };
export async function DELETE(request: Request, { params }: Context) {
  return orderApi(request, 'orders:edit', async (principal) => {
    const { id, testId } = await params;
    const body = await readOrderBody(request);
    const client = await database().connect();
    try {
      return await removeOrderTest(client, principal, id, testId, body);
    } finally {
      client.release();
    }
  });
}
