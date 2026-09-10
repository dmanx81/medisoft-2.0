import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { ordersForPage } from '@/services/orders';
import { OrderList } from '@/components/orders/list';
import { OrderAccessDenied } from '@/components/orders/access';
export const metadata = {
  title: 'Laboratory orders — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function OrdersPage() {
  const user = await requireUser();
  if (!can(user.role, 'orders:read')) return <OrderAccessDenied />;
  return (
    <OrderList
      initial={await ordersForPage(user)}
      canCreate={can(user.role, 'orders:create')}
    />
  );
}
