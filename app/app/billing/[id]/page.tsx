import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { invoiceForPage } from '@/services/billing';
import { InvoiceDetail } from '@/components/billing/detail';
import { BillingAccessDenied } from '@/components/billing/access';
export const metadata = {
  title: 'Invoice — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'billing:read')) return <BillingAccessDenied />;
  const { invoice, payments } = await invoiceForPage(user, (await params).id);
  return (
    <InvoiceDetail
      initial={invoice}
      payments={payments}
      canIssue={can(user.role, 'billing:issue')}
      canPay={can(user.role, 'billing:payment-record')}
      canCancel={can(user.role, 'billing:cancel')}
      canEditDraft={can(user.role, 'billing:create')}
    />
  );
}
