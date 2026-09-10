import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { lookupsForPage, testForPage } from '@/services/catalogue';
import { CatalogueForm } from '@/components/catalogue/form';
import { CatalogueAccessDenied } from '@/components/catalogue/access';
export const metadata = {
  title: 'Edit test — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function EditTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'tests:edit')) return <CatalogueAccessDenied />;
  const { test } = await testForPage(user, (await params).id);
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/app/management/tests/${test.id}`}
        className="text-sm text-teal"
      >
        ← Test overview
      </Link>
      <h1 className="mb-2 mt-4 text-2xl font-semibold">Edit laboratory test</h1>
      <p className="mb-6 text-sm text-slate">
        {test.code} · Changing the definition does not rewrite historical
        reference ranges.
      </p>
      <CatalogueForm initial={test} lookups={await lookupsForPage(user)} />
    </div>
  );
}
