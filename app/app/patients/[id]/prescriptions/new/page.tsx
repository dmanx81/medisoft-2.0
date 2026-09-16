import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { patientForPage } from '@/services/patients';
import { getDoctorByUser } from '@/features/doctors/repository';
import { database } from '@/lib/db';
import { PrescriptionForm } from '@/components/prescriptions/form';
import { PrescriptionAccessDenied } from '@/components/prescriptions/access';
export const metadata = {
  title: 'New prescription — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function NewPrescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'prescriptions:create')) return <PrescriptionAccessDenied />;
  const patient = await patientForPage(user, (await params).id);
  const own = await getDoctorByUser(database(), user);
  return (
    <PrescriptionForm
      patientId={patient.id}
      patientName={`${patient.first_name} ${patient.last_name}`}
      canSelectDoctor={can(user.role, 'doctors:manage')}
      lockedDoctorId={own?.id}
    />
  );
}
