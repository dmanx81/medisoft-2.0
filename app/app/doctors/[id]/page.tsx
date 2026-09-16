import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { doctorForPage } from '@/services/clinical';
import { DoctorForm } from '@/components/clinical/doctor-form';
import { ClinicalAccessDenied } from '@/components/clinical/access';
import { doctorStatusLabels } from '@/features/clinical/format';
export const metadata = {
  title: 'Doctor — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function DoctorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'doctors:read'))
    return <ClinicalAccessDenied module="doctor" />;
  const doctor = await doctorForPage(user, (await params).id);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/app/doctors" className="text-sm text-teal">
        ← Doctors
      </Link>
      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold">
          {doctor.title ? `${doctor.title} ` : ''}
          {doctor.display_name}
        </h1>
        <p className="mt-2 text-sm text-slate">
          {doctor.specialty || 'No specialty recorded'} ·{' '}
          {doctorStatusLabels[doctor.status]}
        </p>
      </header>
      {can(user.role, 'doctors:manage') ? (
        <DoctorForm initial={doctor} />
      ) : (
        <dl className="grid gap-3 rounded-md border border-line bg-white p-5 text-sm">
          {[
            ['License', doctor.license_number],
            ['Department', doctor.department],
            ['Phone', doctor.phone],
            ['Email', doctor.email],
            ['Qualifications', doctor.qualifications],
          ].map(([label, value]) => (
            <div key={label} className="grid grid-cols-2">
              <dt className="text-slate">{label}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
