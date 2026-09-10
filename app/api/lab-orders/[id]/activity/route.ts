import { database } from '@/lib/db';
import { orderApi } from '@/features/orders/http';
import { listOrderActivity } from '@/features/orders/repository';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return orderApi(request, 'orders:read', async (principal) =>
    listOrderActivity(database(), principal, (await params).id),
  );
}
