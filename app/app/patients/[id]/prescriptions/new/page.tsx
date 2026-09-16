import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { patientForPage } from '@/services/patients';
import { PrescriptionForm } from '@/components/clinical/prescription-form';
import { ClinicalAccessDenied } from '@/components/clinical/access';
import { doctorProfileForUser } from '@/features/clinical/doctors';
import { database } from '@/lib/db';
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
  if (!can(user.role, 'prescriptions:create'))
    return <ClinicalAccessDenied module="prescription" />;
  const patient = await patientForPage(user, (await params).id);
  const own = await doctorProfileForUser(database(), user);
  if (user.role === 'DOCTOR' && !own)
    return (
      <section>
        <h1 className="text-2xl font-semibold">Doctor profile required</h1>
        <p className="mt-3 text-slate">
          An administrator must create your clinical doctor profile before you can
          write prescriptions.
        </p>
        <Link href={`/app/patients/${patient.id}`} className="mt-4 inline-block text-teal">
          ← Patient record
        </Link>
      </section>
    );
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/app/patients/${patient.id}`} className="text-sm text-teal">
        ← {patient.first_name} {patient.last_name}
      </Link>
      <h1 className="mb-6 mt-4 text-2xl font-semibold">New prescription</h1>
      <PrescriptionForm
        patientId={patient.id}
        lockDoctorId={user.role === 'DOCTOR' ? own?.id : undefined}
      />
    </div>
  );
}
