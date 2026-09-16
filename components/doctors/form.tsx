'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { emptyDoctor } from '@/features/doctors/validation';
import type { Doctor, StaffCandidate } from '@/features/doctors/types';
import { doctorStatusLabels } from '@/features/doctors/format';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function DoctorForm({
  initial,
  canManage,
}: {
  initial?: Doctor;
  canManage: boolean;
}) {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffCandidate[]>([]);
  const [values, setValues] = useState({
    ...emptyDoctor,
    ...(initial
      ? {
          user_id: initial.user_id,
          first_name: initial.first_name,
          last_name: initial.last_name,
          display_name: initial.display_name,
          title: initial.title,
          specialty: initial.specialty,
          license_number: initial.license_number,
          phone: initial.phone,
          email: initial.email,
          qualifications: initial.qualifications,
          department: initial.department,
          status: initial.status,
        }
      : {}),
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  useEffect(() => {
    if (initial || !canManage) return;
    void (async () => {
      const response = await fetch('/api/doctors/staff', { cache: 'no-store' });
      if (response.ok) setStaff((await response.json()) as StaffCandidate[]);
    })();
  }, [initial, canManage]);
  async function save() {
    if (!canManage) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(
        initial ? `/api/doctors/${initial.id}` : '/api/doctors',
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            initial ? { ...values, version: initial.version } : values,
          ),
          cache: 'no-store',
        },
      );
      const payload = (await response.json()) as Failure & Doctor;
      if (!response.ok) {
        setFailure(payload);
        return;
      }
      if (signatureFile) {
        const form = new FormData();
        form.set('file', signatureFile);
        const signature = await fetch(`/api/doctors/${payload.id}/signature`, {
          method: 'POST',
          body: form,
          cache: 'no-store',
        });
        if (!signature.ok) {
          setFailure((await signature.json()) as Failure);
          router.push(`/app/doctors/${payload.id}`);
          return;
        }
      }
      router.push(`/app/doctors/${payload.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const fields: Array<[keyof typeof values, string, 'input' | 'textarea']> = [
    ['first_name', 'First name', 'input'],
    ['last_name', 'Last name', 'input'],
    ['display_name', 'Display name', 'input'],
    ['title', 'Title', 'input'],
    ['specialty', 'Specialty', 'input'],
    ['license_number', 'Professional / license number', 'input'],
    ['phone', 'Phone', 'input'],
    ['email', 'Email', 'input'],
    ['department', 'Department', 'input'],
    ['qualifications', 'Qualifications', 'textarea'],
  ];
  return (
    <form
      className="mx-auto max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Link href="/app/doctors" className="text-sm text-teal">
        ← Doctors
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">
        {initial ? initial.display_name : 'New doctor'}
      </h1>
      <p className="mt-2 text-sm text-slate">
        A doctor profile is linked to one organization staff account. Profiles
        are deactivated rather than deleted so historical prescriptions remain
        attributable.
      </p>
      {failure && (
        <p className="mt-4 rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {failure.message || 'The doctor profile could not be saved.'}
        </p>
      )}
      <div className="mt-6 grid gap-4 rounded-md border border-line bg-white p-5">
        {!initial && (
          <label className="text-sm font-medium" htmlFor="doctor-staff">
            Staff member
            <NativeSelect
              id="doctor-staff"
              className="mt-2 w-full"
              value={values.user_id}
              onChange={(event) =>
                setValues((current) => ({ ...current, user_id: event.target.value }))
              }
              required
              disabled={!canManage}
            >
              <NativeSelectOption value="">Select staff member</NativeSelectOption>
              {staff.map((person) => (
                <NativeSelectOption key={person.id} value={person.id}>
                  {person.name} · {person.email} · {person.role}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
        {initial && (
          <p className="text-sm text-slate">
            Linked staff: {initial.user_name} ({initial.user_email}) · {initial.user_role}
          </p>
        )}
        {fields.map(([name, label, kind]) => (
          <label key={name} className="text-sm font-medium" htmlFor={`doctor-${name}`}>
            {label}
            {kind === 'textarea' ? (
              <Textarea
                id={`doctor-${name}`}
                className="mt-2"
                value={values[name]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [name]: event.target.value }))
                }
                disabled={!canManage}
              />
            ) : (
              <Input
                id={`doctor-${name}`}
                className="mt-2"
                value={values[name]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [name]: event.target.value }))
                }
                required={name === 'first_name' || name === 'last_name'}
                disabled={!canManage}
              />
            )}
            {failure?.fields?.[name] && (
              <span className="mt-1 block text-xs text-coral">{failure.fields[name]}</span>
            )}
          </label>
        ))}
        <label className="text-sm font-medium" htmlFor="doctor-status">
          Status
          <NativeSelect
            id="doctor-status"
            className="mt-2"
            value={values.status}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                status: event.target.value as 'ACTIVE' | 'INACTIVE',
              }))
            }
            disabled={!canManage}
          >
            {Object.entries(doctorStatusLabels).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {canManage && (
          <label className="text-sm font-medium" htmlFor="doctor-signature">
            Signature image
            <Input
              id="doctor-signature"
              className="mt-2"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setSignatureFile(event.target.files?.[0] ?? null)}
            />
          </label>
        )}
        {initial?.has_signature && (
          <p className="text-xs text-slate">A signature is currently on file for this doctor.</p>
        )}
      </div>
      {canManage && (
        <button
          type="submit"
          disabled={busy}
          className="mt-4 rounded-md bg-teal px-4 py-2 text-sm text-white"
        >
          Save doctor
        </button>
      )}
    </form>
  );
}
