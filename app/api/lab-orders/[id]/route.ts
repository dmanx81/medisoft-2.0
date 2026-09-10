import { database } from '@/lib/db';
import { orderApi, readOrderBody } from '@/features/orders/http';
import { getOrder, updateOrder } from '@/features/orders/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return orderApi(request, 'orders:read', async (principal) =>
    getOrder(database(), principal, (await params).id),
  );
}
export async function PATCH(request: Request, { params }: Context) {
  return orderApi(request, 'orders:edit', async (principal) => {
    const { id } = await params;
    const body = await readOrderBody(request);
    const client = await database().connect();
    try {
      return await updateOrder(client, principal, id, body);
    } finally {
      client.release();
    }
  });
}
