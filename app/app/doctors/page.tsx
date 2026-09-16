import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { doctorsForPage } from '@/services/clinical';
import { DoctorsList } from '@/components/clinical/doctors-list';
import { ClinicalAccessDenied } from '@/components/clinical/access';
export const metadata = {
  title: 'Doctors — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function DoctorsPage() {
  const user = await requireUser();
  if (!can(user.role, 'doctors:read')) return <ClinicalAccessDenied module="doctor" />;
  return (
    <DoctorsList
      initial={await doctorsForPage(user)}
      canManage={can(user.role, 'doctors:manage')}
    />
  );
}
