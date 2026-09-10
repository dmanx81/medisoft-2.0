import '../globals.css';
import { geistSans, geistMono } from '@/lib/fonts';
import { requireUser } from '@/lib/auth/session';
import { ApplicationShell } from '@/components/application/shell';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Workspace — MEDISOFT',
  robots: { index: false, follow: false },
};
export default async function ApplicationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ApplicationShell
          name={user.name}
          organizationName={user.organizationName}
          userRole={user.role}
        >
          {children}
        </ApplicationShell>
      </body>
    </html>
  );
}
