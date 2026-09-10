import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { patientForPage } from '@/services/patients';
import { PatientForm } from '@/components/patients/form';
import { PatientAccessDenied } from '@/components/patients/access';
export const metadata = {
  title: 'Edit patient — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'patients:edit')) return <PatientAccessDenied />;
  const patient = await patientForPage(user, (await params).id);
  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/app/patients/${patient.id}`} className="text-sm text-teal">
        ← Patient overview
      </Link>
      <h1 className="mb-2 mt-4 text-2xl font-semibold">Edit patient</h1>
      <p className="mb-6 text-sm text-slate">
        {patient.patient_number} · Changes are recorded in the activity log.
      </p>
      <PatientForm initial={patient} />
    </div>
  );
}
