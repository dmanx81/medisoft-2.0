import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { invoicesForPage } from '@/services/billing';
import { InvoiceList } from '@/components/billing/list';
import { BillingAccessDenied } from '@/components/billing/access';
export const metadata = {
  title: 'Laboratory billing — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function BillingPage() {
  const user = await requireUser();
  if (!can(user.role, 'billing:read')) return <BillingAccessDenied />;
  return <InvoiceList initial={await invoicesForPage(user)} />;
}
