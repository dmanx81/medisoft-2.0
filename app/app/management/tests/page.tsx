import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { database } from '@/lib/db';
import { listLookups, listTests } from '@/features/catalogue/repository';
import { CatalogueList } from '@/components/catalogue/list';
import { CatalogueAccessDenied } from '@/components/catalogue/access';
export const metadata = {
  title: 'Tests — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function TestsPage() {
  const user = await requireUser();
  if (!can(user.role, 'tests:read')) return <CatalogueAccessDenied />;
  return (
    <CatalogueList
      initial={await listTests(database(), user, {})}
      lookups={await listLookups(database(), user)}
      canCreate={can(user.role, 'tests:create')}
    />
  );
}
