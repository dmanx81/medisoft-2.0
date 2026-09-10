'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  emptyPatient,
  patientSchema,
  fieldErrors,
  type PatientInput,
} from '@/features/patients/validation';
import type { Patient, DuplicateMatch } from '@/features/patients/types';
import { dateLabel } from '@/features/patients/format';
import { formSections } from './fields';
type SaveError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
  duplicates?: DuplicateMatch[];
};
export function PatientForm({ initial }: { initial?: Patient }) {
  const router = useRouter();
  const lock = useRef(false);
  const [values, setValues] = useState<PatientInput>(() =>
    initial
      ? (Object.fromEntries(
          Object.keys(emptyPatient).map((key) => [
            key,
            initial[key as keyof PatientInput],
          ]),
        ) as PatientInput)
      : emptyPatient,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<SaveError | null>(null);
  const [saving, setSaving] = useState(false);
  function change(name: keyof PatientInput, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setFailure(null);
    setErrors((current) => ({ ...current, [name]: '' }));
  }
  async function save(acknowledgeDuplicates = false) {
    if (lock.current) return;
    const parsed = patientSchema.safeParse(values);
    if (!parsed.success) {
      const next = fieldErrors(parsed.error);
      setErrors(next);
      setFailure({
        code: 'VALIDATION',
        message: 'Check the highlighted fields.',
      });
      document.getElementById(`patient-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    lock.current = true;
    setSaving(true);
    setErrors({});
    setFailure(null);
    try {
      const response = await fetch(
        initial ? `/api/patients/${initial.id}` : '/api/patients',
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: parsed.data,
            acknowledgeDuplicates,
            ...(initial ? { version: initial.version } : {}),
          }),
          cache: 'no-store',
        },
      );
      if (response.status === 401) {
        setFailure({
          code: 'UNAUTHENTICATED',
          message:
            'Your session expired. Sign in in another tab, then return here to save.',
        });
        return;
      }
      if (!response.ok) {
        const problem: SaveError = await response.json();
        setFailure(problem);
        setErrors(problem.fields ?? {});
        return;
      }
      const patient: Patient = await response.json();
      router.push(`/app/patients/${patient.id}?saved=1`);
      router.refresh();
    } catch {
      setFailure({
        code: 'UNAVAILABLE',
        message:
          'The save could not be confirmed. Inspect the patient list before retrying to avoid a duplicate record.',
      });
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      noValidate
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="grid gap-5"
    >
      {failure && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <p className="font-medium">{failure.message}</p>
          {failure.code === 'STALE_VERSION' && (
            <a
              className="mt-2 inline-block underline"
              href={`/app/patients/${initial?.id}/edit`}
            >
              Reload the latest record (unsaved changes will be lost)
            </a>
          )}
          {failure.code === 'UNAUTHENTICATED' && (
            <a
              href="/login"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block underline"
            >
              Sign in
            </a>
          )}
          {failure.duplicates?.length ? (
            <ul className="mt-3 grid gap-2">
              {failure.duplicates.map((match) => (
                <li key={match.id}>
                  <Link
                    target="_blank"
                    rel="noreferrer"
                    prefetch={false}
                    href={`/app/patients/${match.id}`}
                    className="font-medium underline"
                  >
                    {match.first_name} {match.last_name} ·{' '}
                    {match.patient_number}
                  </Link>
                  <span className="block">
                    {dateLabel(match.date_of_birth)} · Matches:{' '}
                    {match.reasons.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {failure.code === 'DUPLICATE_WARNING' && (
            <button
              disabled={saving}
              type="button"
              onClick={() => void save(true)}
              className="mt-4 rounded border border-amber-700 px-3 py-2 font-medium"
            >
              I checked the matches —{' '}
              {initial ? 'save changes' : 'create a separate patient'}
            </button>
          )}
        </div>
      )}
      <fieldset disabled={saving} className="contents">
        {formSections.map((section) => (
          <section
            key={section.title}
            className="rounded-md border border-line bg-white p-5"
          >
            <h2 className="mb-4 font-semibold">{section.title}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {section.fields.map((field) => {
                const id = `patient-${field.name}`;
                const error = errors[field.name];
                const described =
                  [field.hint ? `${id}-hint` : '', error ? `${id}-error` : '']
                    .filter(Boolean)
                    .join(' ') || undefined;
                return (
                  <div
                    key={field.name}
                    className={field.type === 'textarea' ? 'md:col-span-2' : ''}
                  >
                    <label
                      htmlFor={id}
                      className="mb-2 block text-sm font-medium"
                    >
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    {field.options ? (
                      <NativeSelect
                        id={id}
                        name={field.name}
                        className="w-full"
                        value={values[field.name]}
                        onChange={(event) =>
                          change(field.name, event.target.value)
                        }
                        aria-invalid={!!error}
                        aria-describedby={described}
                      >
                        {field.options.map((option) => (
                          <NativeSelectOption
                            key={option.value}
                            value={option.value}
                          >
                            {option.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : field.type === 'textarea' ? (
                      <Textarea
                        id={id}
                        name={field.name}
                        rows={4}
                        maxLength={field.max}
                        value={values[field.name]}
                        onChange={(event) =>
                          change(field.name, event.target.value)
                        }
                        aria-invalid={!!error}
                        aria-describedby={described}
                      />
                    ) : (
                      <Input
                        id={id}
                        name={field.name}
                        type={field.type ?? 'text'}
                        required={field.required}
                        maxLength={field.max}
                        max={
                          field.type === 'date'
                            ? new Date().toISOString().slice(0, 10)
                            : undefined
                        }
                        value={values[field.name]}
                        onChange={(event) =>
                          change(field.name, event.target.value)
                        }
                        aria-invalid={!!error}
                        aria-describedby={described}
                      />
                    )}
                    {field.hint && (
                      <p id={`${id}-hint`} className="mt-1 text-xs text-slate">
                        {field.hint}
                      </p>
                    )}
                    {error && (
                      <p
                        id={`${id}-error`}
                        className="mt-1 text-sm text-red-700"
                      >
                        {error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </fieldset>
      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-md border border-line bg-white p-4">
        <Link
          href={initial ? `/app/patients/${initial.id}` : '/app/patients'}
          className="text-sm text-slate underline"
        >
          Cancel
        </Link>
        <button
          disabled={saving}
          type="submit"
          className="rounded-md bg-teal px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Create patient'}
        </button>
      </div>
    </form>
  );
}
