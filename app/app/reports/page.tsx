import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { reportsForPage } from '@/services/reports';
import { ReportList } from '@/components/reports/list';
import { ReportAccessDenied } from '@/components/reports/access';
export const metadata = {
  title: 'Laboratory reports — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function ReportsPage() {
  const user = await requireUser();
  if (!can(user.role, 'reports:read')) return <ReportAccessDenied />;
  return (
    <ReportList
      initial={await reportsForPage(user)}
      canDownload={can(user.role, 'reports:download')}
    />
  );
}
