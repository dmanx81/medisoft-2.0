'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { emptyItem } from '@/features/prescriptions/validation';
import type { Prescription, PrescriptionItemInput } from '@/features/prescriptions/types';
import type { DoctorSummary } from '@/features/doctors/types';
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function PrescriptionForm({
  patientId,
  patientName,
  initial,
  canSelectDoctor,
  lockedDoctorId,
}: {
  patientId: string;
  patientName: string;
  initial?: Prescription;
  canSelectDoctor: boolean;
  lockedDoctorId?: string;
}) {
  const router = useRouter();
  const [doctors, setDoctors] = useState<DoctorSummary[]>([]);
  const [doctorId, setDoctorId] = useState(initial?.doctor_id || lockedDoctorId || '');
  const [date, setDate] = useState(
    initial?.prescription_date || new Date().toISOString().slice(0, 10),
  );
  const [clinicalNote, setClinicalNote] = useState(initial?.clinical_note || '');
  const [instructions, setInstructions] = useState(initial?.general_instructions || '');
  const [items, setItems] = useState<PrescriptionItemInput[]>(
    initial?.items.length
      ? initial.items.map((item) => ({
          medication_name: item.medication_name,
          strength: item.strength,
          form: item.form,
          dose: item.dose,
          route: item.route,
          frequency: item.frequency,
          duration: item.duration,
          quantity: item.quantity,
          instructions: item.instructions,
        }))
      : [{ ...emptyItem }],
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  useEffect(() => {
    if (!canSelectDoctor) return;
    void (async () => {
      const response = await fetch('/api/doctors/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE', pageSize: 50 }),
        cache: 'no-store',
      });
      if (response.ok) {
        const data = (await response.json()) as { doctors: DoctorSummary[] };
        setDoctors(data.doctors);
        setDoctorId((current) => current || data.doctors[0]?.id || '');
      }
    })();
  }, [canSelectDoctor]);
  function changeItem(index: number, patch: Partial<PrescriptionItemInput>) {
    setItems((current) =>
      current.map((item, currentIndex) =>
        currentIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }
  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId || undefined,
        prescription_date: date,
        clinical_note: clinicalNote,
        general_instructions: instructions,
        items: items.filter((item) => item.medication_name.trim()),
        ...(initial ? { version: initial.version } : {}),
      };
      const response = await fetch(
        initial
          ? `/api/prescriptions/${initial.id}`
          : `/api/patients/${patientId}/prescriptions`,
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        },
      );
      const body = (await response.json()) as Failure & Prescription;
      if (!response.ok) {
        setFailure(body);
        return;
      }
      router.push(`/app/prescriptions/${body.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const itemFields: Array<[keyof PrescriptionItemInput, string]> = [
    ['medication_name', 'Medication'],
    ['strength', 'Strength'],
    ['form', 'Form'],
    ['dose', 'Dose'],
    ['route', 'Route'],
    ['frequency', 'Frequency'],
    ['duration', 'Duration'],
    ['quantity', 'Quantity'],
    ['instructions', 'Instructions'],
  ];
  return (
    <form
      className="mx-auto max-w-4xl"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Link href={`/app/patients/${patientId}`} className="text-sm text-teal">
        ← Patient record
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">
        {initial ? 'Edit prescription draft' : 'New prescription'}
      </h1>
      <p className="mt-2 text-sm text-slate">
        {patientName}. Medication lines are structured free text. The software
        does not recommend drugs or doses.
      </p>
      {failure && (
        <p className="mt-4 rounded-md border border-coral/30 bg-white p-3 text-sm text-coral" role="alert">
          {failure.message || 'The prescription could not be saved.'}
        </p>
      )}
      <div className="mt-6 grid gap-4 rounded-md border border-line bg-white p-5">
        {canSelectDoctor ? (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Prescribing doctor</legend>
            {doctors.length === 0 && (
              <p className="text-sm text-slate">
                No active doctor profiles are available. Create a doctor profile
                first.
              </p>
            )}
            {doctors.map((doctor) => (
              <label
                key={doctor.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="rx-doctor"
                  className="mt-1"
                  value={doctor.id}
                  checked={doctorId === doctor.id}
                  onChange={() => setDoctorId(doctor.id)}
                  required
                  aria-label={doctor.display_name}
                />
                {doctor.display_name}
                {doctor.specialty ? (
                  <span className="block text-slate">{doctor.specialty}</span>
                ) : null}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-sm text-slate">
            Prescribing doctor is taken from your clinical staff profile.
          </p>
        )}
        <label className="text-sm font-medium" htmlFor="rx-date">
          Prescription date
          <Input
            id="rx-date"
            className="mt-2"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <label className="text-sm font-medium" htmlFor="rx-note">
          Clinical / diagnostic note
          <Textarea
            id="rx-note"
            className="mt-2"
            value={clinicalNote}
            onChange={(event) => setClinicalNote(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium" htmlFor="rx-instructions">
          General instructions
          <Textarea
            id="rx-instructions"
            className="mt-2"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-4 grid gap-4">
        {items.map((item, index) => (
          <fieldset
            key={index}
            className="grid gap-3 rounded-md border border-line bg-white p-5"
          >
            <legend className="px-1 text-sm font-semibold">
              Medication {index + 1}
            </legend>
            {itemFields.map(([name, label]) => (
              <label key={name} className="text-sm font-medium" htmlFor={`rx-${index}-${name}`}>
                {label}
                <Input
                  id={`rx-${index}-${name}`}
                  className="mt-2"
                  value={item[name]}
                  onChange={(event) => changeItem(index, { [name]: event.target.value })}
                  required={name === 'medication_name'}
                />
              </label>
            ))}
            {items.length > 1 && (
              <button
                type="button"
                className="w-fit text-sm text-coral"
                onClick={() =>
                  setItems((current) => current.filter((_, currentIndex) => currentIndex !== index))
                }
              >
                Remove medication
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          className="w-fit text-sm text-teal"
          onClick={() => setItems((current) => [...current, { ...emptyItem }])}
        >
          Add medication
        </button>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-md bg-teal px-4 py-2 text-sm text-white"
      >
        Save draft
      </button>
    </form>
  );
}
