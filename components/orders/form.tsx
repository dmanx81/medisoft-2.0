'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { PatientSummary } from '@/features/patients/types';
import type { LabTestSummary } from '@/features/catalogue/types';
import { specimenLabels } from '@/features/catalogue/format';
import { fastingLabels, priorityLabels } from '@/features/orders/format';
import {
  labOrderSubmitBody,
  patientSearchBody,
  patientsFromSearchResponse,
} from '@/features/orders/patient-lookup';
type Failure = {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
};
type LookupStatus = 'idle' | 'loading' | 'empty' | 'error';
export function OrderPatientPicker({
  patient,
  onChange,
  canCreatePatient = false,
  fieldError,
}: {
  patient: PatientSummary | null;
  onChange: (patient: PatientSummary | null) => void;
  canCreatePatient?: boolean;
  fieldError?: string;
}) {
  const [patientQuery, setPatientQuery] = useState('');
  const [patientHits, setPatientHits] = useState<PatientSummary[]>([]);
  const [patientStatus, setPatientStatus] = useState<LookupStatus>('idle');
  async function searchPatients() {
    setPatientStatus('loading');
    try {
      const response = await fetch('/api/patients/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patientSearchBody(patientQuery)),
        cache: 'no-store',
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) {
        setPatientHits([]);
        setPatientStatus('error');
        return;
      }
      const patients = patientsFromSearchResponse(await response.json());
      setPatientHits(patients);
      setPatientStatus(patients.length ? 'idle' : 'empty');
    } catch {
      setPatientHits([]);
      setPatientStatus('error');
    }
  }
  const patientLookupMessage =
    patientStatus === 'loading'
      ? 'Loading patients…'
      : patientStatus === 'error'
        ? 'Failed to load patients.'
        : patientStatus === 'empty'
          ? 'No patients found.'
          : 'Search patients…';
  return (
    <section className="rounded-md border border-line bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Patient</h2>
        {canCreatePatient && !patient && (
          <Link className="text-sm text-teal" href="/app/patients/new">
            New patient
          </Link>
        )}
      </div>
      {patient ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>
            <span className="font-medium">
              {patient.first_name} {patient.last_name}
            </span>
            <span className="ml-2 font-mono text-sm text-slate">
              {patient.patient_number}
            </span>
          </p>
          <button
            type="button"
            className="text-sm text-teal"
            onClick={() => {
              onChange(null);
              setPatientHits([]);
              setPatientStatus('idle');
            }}
          >
            Change patient
          </button>
        </div>
      ) : (
        <div>
          <label className="text-sm font-medium" htmlFor="order-patient">
            Search patients
          </label>
          <div className="mt-2 flex gap-2">
            <Input
              id="order-patient"
              type="search"
              value={patientQuery}
              onChange={(event) => setPatientQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void searchPatients();
                }
              }}
              maxLength={150}
              autoComplete="off"
              placeholder="Name, number or identifier"
            />
            <button
              type="button"
              className="rounded-md bg-teal px-4 text-sm text-white disabled:opacity-50"
              disabled={patientStatus === 'loading'}
              onClick={() => void searchPatients()}
            >
              {patientStatus === 'loading' ? 'Finding…' : 'Find'}
            </button>
          </div>
          {fieldError && (
            <p className="mt-2 text-sm text-coral">{fieldError}</p>
          )}
          {patientHits.length > 0 ? (
            <ul className="mt-3 divide-y divide-line">
              {patientHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="w-full px-1 py-2 text-left text-sm hover:bg-mint"
                    onClick={() => {
                      onChange(hit);
                      setPatientHits([]);
                      setPatientStatus('idle');
                    }}
                  >
                    {hit.first_name} {hit.last_name}
                    <span className="ml-2 font-mono text-xs text-slate">
                      {hit.patient_number}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <output className="mt-3 block text-sm text-slate">
              {patientLookupMessage}
            </output>
          )}
        </div>
      )}
    </section>
  );
}
export function OrderForm({
  initialPatient,
  canCreatePatient = false,
}: {
  initialPatient?: PatientSummary | null;
  canCreatePatient?: boolean;
}) {
  const router = useRouter();
  const [patient, setPatient] = useState<PatientSummary | null>(
    initialPatient ?? null,
  );
  const [testQuery, setTestQuery] = useState('');
  const [testHits, setTestHits] = useState<LabTestSummary[]>([]);
  const [selected, setSelected] = useState<LabTestSummary[]>([]);
  const [priority, setPriority] = useState<'ROUTINE' | 'URGENT'>('ROUTINE');
  const [fasting, setFasting] = useState<'UNKNOWN' | 'FASTING' | 'NON_FASTING'>(
    'UNKNOWN',
  );
  const [physician, setPhysician] = useState('');
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const expected = useMemo(() => {
    const groups = new Map<string, LabTestSummary[]>();
    for (const test of selected) {
      const list = groups.get(test.specimen_type) ?? [];
      list.push(test);
      groups.set(test.specimen_type, list);
    }
    return [...groups.entries()];
  }, [selected]);
  async function searchTests() {
    const response = await fetch('/api/tests/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: testQuery,
        status: 'ACTIVE',
        pageSize: 20,
        sort: 'code',
      }),
      cache: 'no-store',
    });
    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }
    if (!response.ok) return;
    const data = (await response.json()) as { tests: LabTestSummary[] };
    setTestHits(data.tests);
  }
  function addTest(test: LabTestSummary) {
    if (selected.some((row) => row.id === test.id)) return;
    setSelected((current) => [...current, test]);
  }
  async function save(place: boolean) {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch('/api/lab-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          labOrderSubmitBody(
            patient,
            {
              priority,
              ordering_physician_name: physician,
              clinical_notes: notes,
              fasting_status: fasting,
              external_reference: reference,
            },
            selected.map((test) => test.id),
            place,
          ),
        ),
      });
      const body = (await response.json()) as Failure & { id?: string };
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) {
        setFailure(body);
        return;
      }
      router.push(`/app/laboratory/orders/${body.id}?saved=1`);
    } catch {
      setFailure({
        message: 'The order could not be saved. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      {failure && (
        <p
          className="rounded-md border border-coral/30 bg-white p-3 text-sm text-coral"
          role="alert"
        >
          {failure.message || 'Check the highlighted fields.'}
        </p>
      )}
      <OrderPatientPicker
        patient={patient}
        onChange={setPatient}
        canCreatePatient={canCreatePatient}
        fieldError={failure?.fields?.patient_id}
      />
      <section className="rounded-md border border-line bg-white p-5">
        <h2 className="mb-4 font-semibold">Ordered tests</h2>
        <label className="text-sm font-medium" htmlFor="order-tests">
          Search active catalogue tests
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="order-tests"
            value={testQuery}
            onChange={(event) => setTestQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void searchTests();
              }
            }}
            placeholder="Code or name"
          />
          <button
            type="button"
            className="rounded-md bg-teal px-4 text-sm text-white"
            onClick={() => void searchTests()}
          >
            Find
          </button>
        </div>
        <ul className="mt-3 divide-y divide-line">
          {testHits.map((test) => (
            <li
              key={test.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div>
                <span className="font-mono text-sm">{test.code}</span>{' '}
                {test.name}
                <span className="ml-2 text-xs text-slate">
                  {specimenLabels[test.specimen_type]}
                </span>
              </div>
              <button
                type="button"
                className="text-sm text-teal"
                onClick={() => addTest(test)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
        {selected.length === 0 ? (
          <p className="mt-4 text-sm text-slate">No tests selected yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line">
            {selected.map((test) => (
              <li
                key={test.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-mono">{test.code}</span> {test.name} ·{' '}
                  {specimenLabels[test.specimen_type]}
                </span>
                <button
                  type="button"
                  className="text-coral"
                  onClick={() =>
                    setSelected((current) =>
                      current.filter((row) => row.id !== test.id),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {expected.length > 0 && (
          <div className="mt-4 rounded-md bg-mint p-3 text-sm">
            <p className="font-medium">Expected specimens</p>
            <ul className="mt-2 grid gap-1">
              {expected.map(([type, tests]) => (
                <li key={type}>
                  {specimenLabels[type]}:{' '}
                  {tests.map((test) => test.code).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section className="grid gap-4 rounded-md border border-line bg-white p-5 md:grid-cols-2">
        <label className="text-sm font-medium" htmlFor="order-priority">
          Priority
          <NativeSelect
            id="order-priority"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as 'ROUTINE' | 'URGENT')
            }
          >
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="text-sm font-medium" htmlFor="order-fasting">
          Fasting
          <NativeSelect
            id="order-fasting"
            className="mt-2 h-9 w-full rounded-md border border-line bg-white px-2"
            value={fasting}
            onChange={(event) =>
              setFasting(
                event.target.value as 'UNKNOWN' | 'FASTING' | 'NON_FASTING',
              )
            }
          >
            {Object.entries(fastingLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label
          className="text-sm font-medium md:col-span-2"
          htmlFor="order-physician"
        >
          Ordering physician
          <Input
            id="order-physician"
            value={physician}
            onChange={(event) => setPhysician(event.target.value)}
            maxLength={160}
            className="mt-2"
          />
        </label>
        <label
          className="text-sm font-medium md:col-span-2"
          htmlFor="order-reference"
        >
          External reference
          <Input
            id="order-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={80}
            className="mt-2"
          />
        </label>
        <label
          className="text-sm font-medium md:col-span-2"
          htmlFor="order-notes"
        >
          Clinical notes
          <textarea
            id="order-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={4000}
            rows={4}
            className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </label>
      </section>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium"
        >
          Save draft
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          onClick={() => void save(true)}
        >
          Place order
        </button>
      </div>
    </form>
  );
}
