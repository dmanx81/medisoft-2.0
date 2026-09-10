import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { orderForPage } from '@/services/orders';
import { OrderDetail } from '@/components/orders/detail';
import { OrderAccessDenied } from '@/components/orders/access';
import { orderStatusLabels, priorityLabels } from '@/features/orders/format';
export const metadata = {
  title: 'Laboratory order — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'orders:read')) return <OrderAccessDenied />;
  const { order, activity } = await orderForPage(user, (await params).id);
  const { saved } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/app/laboratory/orders" className="text-sm text-teal">
        ← Orders
      </Link>
      {saved === '1' && (
        <output className="mt-4 block rounded-md border border-teal/20 bg-mint p-3 text-sm text-teal">
          Laboratory order saved.
        </output>
      )}
      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold">
              {order.order_number}
            </h1>
            <span className="rounded border border-line bg-white px-2 py-1 text-xs">
              {orderStatusLabels[order.status]}
            </span>
            <span className="rounded border border-line bg-white px-2 py-1 text-xs">
              {priorityLabels[order.priority]}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate">
            {order.patient_first_name} {order.patient_last_name} ·{' '}
            {order.patient_number}
          </p>
        </div>
      </header>
      <OrderDetail
        initial={order}
        activity={activity}
        canEdit={can(user.role, 'orders:edit')}
        canPlace={can(user.role, 'orders:place')}
        canCancel={can(user.role, 'orders:cancel')}
        canCollect={can(user.role, 'samples:collect')}
        canReceive={can(user.role, 'samples:receive')}
        canReject={can(user.role, 'samples:reject')}
      />
    </div>
  );
}
