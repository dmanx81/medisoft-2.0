import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { database } from '@/lib/db';
import { listPatients } from '@/features/patients/repository';
import { PatientList } from '@/components/patients/list';
import { PatientAccessDenied } from '@/components/patients/access';
export const metadata = {
  title: 'Patients — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function PatientsPage() {
  const user = await requireUser();
  if (!can(user.role, 'patients:read')) return <PatientAccessDenied />;
  return (
    <PatientList
      initial={await listPatients(database(), user, {})}
      canCreate={can(user.role, 'patients:create')}
    />
  );
}
