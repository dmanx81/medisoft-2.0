import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { orderForPage } from '@/services/orders';
import { OrderDetail } from '@/components/orders/detail';
import { OrderAccessDenied } from '@/components/orders/access';
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
      <OrderDetail
        initial={order}
        activity={activity}
        canEdit={can(user.role, 'orders:edit')}
        canPlace={can(user.role, 'orders:place')}
        canCancel={can(user.role, 'orders:cancel')}
        canCollect={can(user.role, 'samples:collect')}
        canReceive={can(user.role, 'samples:receive')}
        canReject={can(user.role, 'samples:reject')}
        canReadResults={can(user.role, 'results:read')}
        canEnterResults={can(user.role, 'results:enter')}
        canValidateResults={can(user.role, 'results:validate')}
        canVerifyResults={can(user.role, 'results:verify')}
        canAmendResults={can(user.role, 'results:amend')}
        canReadReports={can(user.role, 'reports:read')}
        canGenerateReports={can(user.role, 'reports:generate')}
        canDownloadReports={can(user.role, 'reports:download')}
        canDeliverReports={can(user.role, 'reports:deliver')}
        canShareReports={can(user.role, 'reports:share')}
        canRevokeReportShares={can(user.role, 'reports:share-revoke')}
        canReadBilling={can(user.role, 'billing:read')}
        canCreateBilling={can(user.role, 'billing:create')}
        canIssueBilling={can(user.role, 'billing:issue')}
        canRecordPayments={can(user.role, 'billing:payment-record')}
      />
    </div>
  );
}
