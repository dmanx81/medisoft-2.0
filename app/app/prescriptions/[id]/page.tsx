import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { prescriptionForPage } from '@/services/clinical';
import { PrescriptionDetail } from '@/components/clinical/prescription-detail';
import { ClinicalAccessDenied } from '@/components/clinical/access';
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
  if (!can(user.role, 'prescriptions:read'))
    return <ClinicalAccessDenied module="prescription" />;
  const prescription = await prescriptionForPage(user, (await params).id);
  return (
    <PrescriptionDetail
      prescription={prescription}
      canFinalize={can(user.role, 'prescriptions:finalize')}
      canCancel={can(user.role, 'prescriptions:cancel')}
      canCreate={can(user.role, 'prescriptions:create')}
      canDownload={can(user.role, 'prescriptions:download')}
    />
  );
}
