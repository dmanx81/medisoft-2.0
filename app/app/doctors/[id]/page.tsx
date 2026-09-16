import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { doctorForPage } from '@/services/doctors';
import { DoctorForm } from '@/components/doctors/form';
import { DoctorAccessDenied } from '@/components/doctors/access';
export const metadata = {
  title: 'Doctor — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function DoctorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'doctors:read')) return <DoctorAccessDenied />;
  const doctor = await doctorForPage(user, (await params).id);
  return (
    <DoctorForm initial={doctor} canManage={can(user.role, 'doctors:manage')} />
  );
}
