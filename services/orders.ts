import 'server-only';
import { notFound } from 'next/navigation';
import { database } from '@/lib/db';
import type { Principal } from '@/lib/auth/permissions';
import {
  getOrder,
  listOrderActivity,
  listOrders,
} from '@/features/orders/repository';
import { attachResults } from '@/features/orders/http';
import { OrderError } from '@/features/orders/types';
export async function orderForPage(principal: Principal, id: string) {
  try {
    const order = await attachResults(
      database(),
      principal,
      await getOrder(database(), principal, id),
    );
    const activity = await listOrderActivity(database(), principal, id);
    return { order, activity };
  } catch (error) {
    if (error instanceof OrderError && error.status === 404) notFound();
    throw error;
  }
}
export async function ordersForPage(principal: Principal, input: unknown = {}) {
  return listOrders(database(), principal, input);
}
