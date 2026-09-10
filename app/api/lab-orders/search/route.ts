import { database } from '@/lib/db';
import { orderApi, readOrderBody } from '@/features/orders/http';
import { listOrders } from '@/features/orders/repository';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return orderApi(request, 'orders:read', async (principal) =>
    listOrders(database(), principal, await readOrderBody(request)),
  );
}
