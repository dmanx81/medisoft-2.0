import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { prescriptionForPage } from '@/services/prescriptions';
import { PrescriptionDetail } from '@/components/prescriptions/detail';
import { PrescriptionAccessDenied } from '@/components/prescriptions/access';
export const metadata = {
  title: 'Prescription — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function PrescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'prescriptions:read')) return <PrescriptionAccessDenied />;
  const prescription = await prescriptionForPage(user, (await params).id);
  return (
    <PrescriptionDetail
      initial={prescription}
      canFinalize={can(user.role, 'prescriptions:finalize')}
      canCancel={can(user.role, 'prescriptions:cancel')}
      canEditDraft={can(user.role, 'prescriptions:create')}
      canDownload={can(user.role, 'prescriptions:download')}
    />
  );
}
