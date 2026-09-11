import { database } from '@/lib/db';
import { attachResults, orderApi, readOrderBody } from '@/features/orders/http';
import { createOrder } from '@/features/orders/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return orderApi(request, 'orders:create', async (principal) => {
    const body = await readOrderBody(request);
    const client = await database().connect();
    try {
      return await attachResults(
        client,
        principal,
        await createOrder(client, principal, body),
      );
    } finally {
      client.release();
    }
  });
}
