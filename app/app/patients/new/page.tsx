import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { PatientForm } from '@/components/patients/form';
import { PatientAccessDenied } from '@/components/patients/access';
export const metadata = {
  title: 'New patient — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function NewPatientPage() {
  const user = await requireUser();
  if (!can(user.role, 'patients:create')) return <PatientAccessDenied />;
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/patients" className="text-sm text-teal">
        ← Patients
      </Link>
      <h1 className="mb-2 mt-4 text-2xl font-semibold">New patient</h1>
      <p className="mb-6 text-sm text-slate">
        First and last name are required. Other information can be added later.
      </p>
      <PatientForm />
    </div>
  );
}
