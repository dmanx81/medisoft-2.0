import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { patientForPage } from '@/services/patients';
import { PatientDetail } from '@/components/patients/detail';
import { PatientAccessDenied } from '@/components/patients/access';
import { ageOn, dateLabel } from '@/features/patients/format';
export const metadata = {
  title: 'Patient record — MEDISOFT',
  referrer: 'no-referrer',
};
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, 'patients:read')) return <PatientAccessDenied />;
  const patient = await patientForPage(user, (await params).id);
  const age = ageOn(patient.date_of_birth);
  const { saved } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/app/patients" className="text-sm text-teal">
        ← Patients
      </Link>
      {saved === '1' && (
        <output className="mt-4 block rounded-md border border-teal/20 bg-mint p-3 text-sm text-teal">
          Patient record saved.
        </output>
      )}
      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {patient.first_name} {patient.last_name}
            </h1>
            <span className="rounded border border-line bg-white px-2 py-1 text-xs">
              {patient.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate">
            {patient.patient_number} · {dateLabel(patient.date_of_birth)}
            {age !== null ? ` · ${age} years` : ''}
          </p>
          <p className="mt-1 text-sm text-slate">
            {patient.phone || patient.email || 'No primary contact recorded'}
          </p>
        </div>
        {can(user.role, 'patients:edit') && (
          <Link
            href={`/app/patients/${patient.id}/edit`}
            prefetch={false}
            className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          >
            Edit patient
          </Link>
        )}
      </header>
      <PatientDetail
        patient={patient}
        canActivity={can(user.role, 'patients:activity')}
        canReadOrders={can(user.role, 'orders:read')}
        canCreateOrders={can(user.role, 'orders:create')}
        canReadBilling={can(user.role, 'billing:read')}
      />
    </div>
  );
}
