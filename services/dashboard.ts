import 'server-only';
import { requireUser } from '@/lib/auth/session';
import { environment } from '@/lib/env';
import { demoOrders } from '@/features/dashboard/demo';
export async function getDashboard() {
  await requireUser('dashboard:read');
  const demo = environment().DASHBOARD_DEMO === 'true';
  return {
    demo,
    metrics: demo ? [12, 5, 3, 1, 1] : [0, 0, 0, 0, 0],
    orders: demo ? demoOrders : [],
  };
}
