import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { prescriptionForPage } from '@/services/clinical';
import { PrescriptionForm } from '@/components/clinical/prescription-form';
import { ClinicalAccessDenied } from '@/components/clinical/access';
import { doctorProfileForUser } from '@/features/clinical/doctors';
import { database } from '@/lib/db';
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
  if (!can(user.role, 'prescriptions:create'))
    return <ClinicalAccessDenied module="prescription" />;
  const prescription = await prescriptionForPage(user, (await params).id);
  if (prescription.status !== 'DRAFT')
    return (
      <section>
        <h1 className="text-2xl font-semibold">Prescription is not editable</h1>
        <p className="mt-3 text-slate">
          Finalized and cancelled prescriptions keep their frozen clinical content.
        </p>
        <Link href={`/app/prescriptions/${prescription.id}`} className="mt-4 inline-block text-teal">
          View prescription
        </Link>
      </section>
    );
  const own = await doctorProfileForUser(database(), user);
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/app/prescriptions/${prescription.id}`} className="text-sm text-teal">
        ← Prescription
      </Link>
      <h1 className="mb-6 mt-4 text-2xl font-semibold">Edit draft</h1>
      <PrescriptionForm
        patientId={prescription.patient_id}
        initial={prescription}
        lockDoctorId={user.role === 'DOCTOR' ? own?.id : undefined}
      />
    </div>
  );
}
