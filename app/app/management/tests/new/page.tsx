import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { lookupsForPage } from '@/services/catalogue';
import { CatalogueForm } from '@/components/catalogue/form';
import { CatalogueAccessDenied } from '@/components/catalogue/access';
export const metadata = {
  title: 'New test — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function NewTestPage() {
  const user = await requireUser();
  if (!can(user.role, 'tests:create')) return <CatalogueAccessDenied />;
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/management/tests" className="text-sm text-teal">
        ← Tests
      </Link>
      <h1 className="mb-2 mt-4 text-2xl font-semibold">New laboratory test</h1>
      <p className="mb-6 text-sm text-slate">
        Codes are unique within your organization. Reference ranges are added
        after the test exists.
      </p>
      <CatalogueForm lookups={await lookupsForPage(user)} />
    </div>
  );
}
