import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { prescriptionForPage } from '@/services/prescriptions';
import { patientForPage } from '@/services/patients';
import { getDoctorByUser } from '@/features/doctors/repository';
import { database } from '@/lib/db';
import { PrescriptionForm } from '@/components/prescriptions/form';
import { PrescriptionAccessDenied } from '@/components/prescriptions/access';
import { notFound } from 'next/navigation';
export const metadata = {
  title: 'Edit prescription — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function EditPrescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'prescriptions:create')) return <PrescriptionAccessDenied />;
  const prescription = await prescriptionForPage(user, (await params).id);
  if (prescription.status !== 'DRAFT') notFound();
  const patient = await patientForPage(user, prescription.patient_id);
  const own = await getDoctorByUser(database(), user);
  return (
    <PrescriptionForm
      patientId={patient.id}
      patientName={`${patient.first_name} ${patient.last_name}`}
      initial={prescription}
      canSelectDoctor={can(user.role, 'doctors:manage')}
      lockedDoctorId={own?.id}
    />
  );
}
