import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { DoctorForm } from '@/components/clinical/doctor-form';
import { ClinicalAccessDenied } from '@/components/clinical/access';
export const metadata = {
  title: 'New doctor — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function NewDoctorPage() {
  const user = await requireUser();
  if (!can(user.role, 'doctors:manage'))
    return <ClinicalAccessDenied module="doctor" />;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/app/doctors" className="text-sm text-teal">
        ← Doctors
      </Link>
      <h1 className="mb-6 mt-4 text-2xl font-semibold">New doctor</h1>
      <DoctorForm />
    </div>
  );
}
