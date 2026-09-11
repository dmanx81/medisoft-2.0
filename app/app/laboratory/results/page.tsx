import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { resultWorkForPage } from '@/services/results';
import { ResultWorkList } from '@/components/results/list';
import { ResultAccessDenied } from '@/components/results/access';
export const metadata = {
  title: 'Laboratory results — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function ResultsPage() {
  const user = await requireUser();
  if (!can(user.role, 'results:read')) return <ResultAccessDenied />;
  return <ResultWorkList initial={await resultWorkForPage(user)} />;
}
