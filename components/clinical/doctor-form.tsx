'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import type { ClinicalDoctor, StaffLookup } from '@/features/clinical/types';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function DoctorForm({ initial }: { initial?: ClinicalDoctor }) {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffLookup[]>([]);
  const [values, setValues] = useState({
    user_id: initial?.user_id ?? '',
    email: '',
    first_name: initial?.first_name ?? '',
    last_name: initial?.last_name ?? '',
    display_name: initial?.display_name ?? '',
    title: initial?.title ?? '',
    specialty: initial?.specialty ?? '',
    license_number: initial?.license_number ?? '',
    phone: initial?.phone ?? '',
    professional_email: initial?.email ?? '',
    qualifications: initial?.qualifications ?? '',
    department: initial?.department ?? '',
    status: initial?.status ?? 'ACTIVE',
  });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (initial) return;
    void (async () => {
      const response = await fetch('/api/clinical-doctors/lookups', { cache: 'no-store' });
      if (!response.ok) return;
      setStaff((await response.json()) as StaffLookup[]);
    })();
  }, [initial]);
  function change(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFailure(null);
  }
  return (
    <form
      className="grid max-w-3xl gap-4 rounded-md border border-line bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setFailure(null);
        void (async () => {
          try {
            const response = await fetch(
              initial ? `/api/clinical-doctors/${initial.id}` : '/api/clinical-doctors',
              {
                method: initial ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                  initial
                    ? { ...values, version: initial.version }
                    : { ...values, user_id: values.user_id || undefined },
                ),
                cache: 'no-store',
              },
            );
            const payload = (await response.json()) as Failure & ClinicalDoctor;
            if (!response.ok) {
              setFailure(payload);
              return;
            }
            router.push(`/app/doctors/${payload.id}`);
            router.refresh();
          } finally {
            setSaving(false);
          }
        })();
      }}
    >
      {failure && (
        <p className="rounded-md border border-coral/30 p-3 text-sm text-coral" role="alert">
          {failure.message || 'Doctor profile could not be saved.'}
        </p>
      )}
      {!initial && (
        <>
          <label className="text-sm font-medium" htmlFor="doctor-staff">
            Existing staff member
            <NativeSelect
              id="doctor-staff"
              className="mt-2"
              value={values.user_id}
              onChange={(event) => change('user_id', event.target.value)}
            >
              <option value="">Create a new invited doctor account</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id} disabled={!!person.doctor_id}>
                  {person.name} ({person.email})
                  {person.doctor_id ? ' — already a doctor' : ''}
                </option>
              ))}
            </NativeSelect>
          </label>
          {!values.user_id && (
            <label className="text-sm font-medium" htmlFor="doctor-email">
              Login email
              <Input
                id="doctor-email"
                className="mt-2"
                type="email"
                value={values.email}
                onChange={(event) => change('email', event.target.value)}
                required={!values.user_id}
              />
            </label>
          )}
        </>
      )}
      {(
        [
          ['first_name', 'First name'],
          ['last_name', 'Last name'],
          ['display_name', 'Display name'],
          ['title', 'Title'],
          ['specialty', 'Specialty'],
          ['license_number', 'Professional / license number'],
          ['phone', 'Phone'],
          ['professional_email', 'Professional email'],
          ['department', 'Department'],
        ] as const
      ).map(([name, label]) => (
        <label key={name} className="text-sm font-medium" htmlFor={`doctor-${name}`}>
          {label}
          <Input
            id={`doctor-${name}`}
            className="mt-2"
            value={values[name]}
            onChange={(event) => change(name, event.target.value)}
            required={name === 'first_name' || name === 'last_name'}
          />
        </label>
      ))}
      <label className="text-sm font-medium" htmlFor="doctor-qualifications">
        Qualifications
        <Textarea
          id="doctor-qualifications"
          className="mt-2"
          value={values.qualifications}
          onChange={(event) => change('qualifications', event.target.value)}
        />
      </label>
      <label className="text-sm font-medium" htmlFor="doctor-status">
        Status
        <NativeSelect
          id="doctor-status"
          className="mt-2"
          value={values.status}
          onChange={(event) => change('status', event.target.value)}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </NativeSelect>
      </label>
      {initial && (
        <div className="grid gap-2 border-t border-line pt-4">
          <label className="text-sm font-medium" htmlFor="doctor-signature">
            Signature image
            <Input
              id="doctor-signature"
              className="mt-2"
              type="file"
              name="signature"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const data = new FormData();
                data.set('signature', file);
                void (async () => {
                  const response = await fetch(
                    `/api/clinical-doctors/${initial.id}/signature`,
                    { method: 'POST', body: data },
                  );
                  if (!response.ok) {
                    const payload = (await response.json()) as Failure;
                    setFailure(payload);
                  }
                })();
              }}
            />
          </label>
          <p className="text-xs text-slate">
            Optional PNG, JPEG or WebP, up to 256 KB. Stored in the organization
            database and frozen onto finalized prescriptions.
          </p>
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          disabled={saving}
        >
          {initial ? 'Save doctor' : 'Create doctor'}
        </button>
        <Link href="/app/doctors" className="rounded-md border border-line px-4 py-2 text-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}
