import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { DoctorForm } from '@/components/doctors/form';
import { DoctorAccessDenied } from '@/components/doctors/access';
export const metadata = {
  title: 'New doctor — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function NewDoctorPage() {
  const user = await requireUser();
  if (!can(user.role, 'doctors:manage')) return <DoctorAccessDenied />;
  return <DoctorForm canManage />;
}
