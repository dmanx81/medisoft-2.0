import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { lookupsForPage, testForPage } from '@/services/catalogue';
import { CatalogueDetail } from '@/components/catalogue/detail';
import { CatalogueAccessDenied } from '@/components/catalogue/access';
export const metadata = {
  title: 'Laboratory test — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function TestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'tests:read')) return <CatalogueAccessDenied />;
  const { test, ranges } = await testForPage(user, (await params).id);
  const lookups = await lookupsForPage(user);
  const { saved } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/app/management/tests" className="text-sm text-teal">
        ← Tests
      </Link>
      {saved === '1' && (
        <output className="mt-4 block rounded-md border border-teal/20 bg-mint p-3 text-sm text-teal">
          Laboratory test saved.
        </output>
      )}
      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{test.name}</h1>
            <span className="rounded border border-line bg-white px-2 py-1 font-mono text-xs">
              {test.code}
            </span>
            <span className="rounded border border-line bg-white px-2 py-1 text-xs">
              {test.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate">
            {test.category_name} · version {test.version}
          </p>
        </div>
        {can(user.role, 'tests:edit') && (
          <Link
            href={`/app/management/tests/${test.id}/edit`}
            prefetch={false}
            className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          >
            Edit test
          </Link>
        )}
      </header>
      <CatalogueDetail
        test={test}
        ranges={ranges}
        lookups={lookups}
        canEdit={can(user.role, 'tests:edit')}
      />
    </div>
  );
}
