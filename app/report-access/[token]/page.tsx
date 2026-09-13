import { cookies } from 'next/headers';
import { Logo } from '@/components/site/logo';
import { database } from '@/lib/db';
import { inspectPublicShare, shareCookie } from '@/features/reports/shares';
import { PublicReportAccess } from '@/components/reports/public-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ReportAccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = (await cookies()).get(shareCookie)?.value;
  const inspection = await inspectPublicShare(database(), token, session);
  return (
    <main className="min-h-screen bg-ivory px-4 py-10 text-ink">
      <div className="mx-auto max-w-xl">
        <Logo />
        <div className="mt-10">
          <PublicReportAccess
            token={token}
            initial={
              inspection.status === 'ready' && inspection.view
                ? { status: 'ready', view: inspection.view }
                : { status: inspection.status }
            }
          />
        </div>
      </div>
    </main>
  );
}
