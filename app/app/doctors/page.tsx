import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { database } from '@/lib/db';
import { listDoctors } from '@/features/doctors/repository';
import { DoctorList } from '@/components/doctors/list';
import { DoctorAccessDenied } from '@/components/doctors/access';
export const metadata = {
  title: 'Doctors — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function DoctorsPage() {
  const user = await requireUser();
  if (!can(user.role, 'doctors:read')) return <DoctorAccessDenied />;
  return (
    <DoctorList
      initial={await listDoctors(database(), user, {})}
      canManage={can(user.role, 'doctors:manage')}
    />
  );
}
