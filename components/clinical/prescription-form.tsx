'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import type {
  ClinicalDoctorSummary,
  ClinicalPrescription,
  PrescriptionItemInput,
} from '@/features/clinical/types';
const emptyLine: PrescriptionItemInput = {
  medication_name: '',
  strength: '',
  form: '',
  dose: '',
  route: '',
  frequency: '',
  duration: '',
  quantity: '',
  instructions: '',
};
type Failure = { code?: string; message?: string; fields?: Record<string, string> };
export function PrescriptionForm({
  patientId,
  initial,
  lockDoctorId,
}: {
  patientId: string;
  initial?: ClinicalPrescription;
  lockDoctorId?: string;
}) {
  const router = useRouter();
  const [doctors, setDoctors] = useState<ClinicalDoctorSummary[]>([]);
  const [doctorId, setDoctorId] = useState(initial?.doctor_id || lockDoctorId || '');
  const [prescribedOn, setPrescribedOn] = useState(
    initial?.prescribed_on?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  );
  const [clinicalNote, setClinicalNote] = useState(initial?.clinical_note || '');
  const [instructions, setInstructions] = useState(initial?.instructions || '');
  const [items, setItems] = useState<PrescriptionItemInput[]>(
    initial?.items.length
      ? initial.items.map(({ id: _id, sort_order: _order, ...item }) => item)
      : [{ ...emptyLine }],
  );
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/clinical-doctors/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE', pageSize: 50 }),
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = (await response.json()) as { doctors: ClinicalDoctorSummary[] };
      setDoctors(data.doctors);
      if (!doctorId && data.doctors[0] && !lockDoctorId) setDoctorId(data.doctors[0].id);
    })();
  }, [doctorId, lockDoctorId]);
  function changeItem(index: number, name: keyof PrescriptionItemInput, value: string) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [name]: value } : item,
      ),
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setFailure(null);
        void (async () => {
          try {
            const payload = {
              patient_id: patientId,
              doctor_id: doctorId,
              prescribed_on: prescribedOn,
              clinical_note: clinicalNote,
              instructions,
              items: items.filter((item) => item.medication_name.trim()),
              version: initial?.version,
            };
            const response = await fetch(
              initial
                ? `/api/clinical-prescriptions/${initial.id}`
                : '/api/clinical-prescriptions',
              {
                method: initial ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                cache: 'no-store',
              },
            );
            const body = (await response.json()) as Failure & ClinicalPrescription;
            if (!response.ok) {
              setFailure(body);
              return;
            }
            router.push(`/app/prescriptions/${body.id}`);
            router.refresh();
          } finally {
            setSaving(false);
          }
        })();
      }}
    >
      {failure && (
        <p className="rounded-md border border-coral/30 p-3 text-sm text-coral" role="alert">
          {failure.message || 'The prescription could not be saved.'}
        </p>
      )}
      <label className="text-sm font-medium" htmlFor="rx-doctor">
        Prescribing doctor
        <NativeSelect
          id="rx-doctor"
          className="mt-2"
          value={doctorId}
          disabled={!!lockDoctorId}
          onChange={(event) => setDoctorId(event.target.value)}
          required
        >
          <option value="">Select doctor</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.display_name}
              {doctor.specialty ? ` — ${doctor.specialty}` : ''}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="text-sm font-medium" htmlFor="rx-date">
        Prescription date
        <Input
          id="rx-date"
          className="mt-2"
          type="date"
          value={prescribedOn}
          onChange={(event) => setPrescribedOn(event.target.value)}
          required
        />
      </label>
      <label className="text-sm font-medium" htmlFor="rx-note">
        Clinical note
        <Textarea
          id="rx-note"
          className="mt-2"
          value={clinicalNote}
          onChange={(event) => setClinicalNote(event.target.value)}
        />
      </label>
      <div>
        <h2 className="font-medium">Medications</h2>
        <div className="mt-3 grid gap-4">
          {items.map((item, index) => (
            <fieldset
              key={index}
              className="grid gap-3 rounded-md border border-line p-4 md:grid-cols-2"
            >
              <legend className="px-1 text-sm font-medium">Medication {index + 1}</legend>
              {(
                [
                  ['medication_name', 'Medication'],
                  ['strength', 'Strength'],
                  ['form', 'Form'],
                  ['dose', 'Dose'],
                  ['route', 'Route'],
                  ['frequency', 'Frequency'],
                  ['duration', 'Duration'],
                  ['quantity', 'Quantity'],
                ] as const
              ).map(([name, label]) => (
                <label key={name} className="text-sm font-medium" htmlFor={`rx-${index}-${name}`}>
                  {label}
                  <Input
                    id={`rx-${index}-${name}`}
                    className="mt-2"
                    value={item[name]}
                    onChange={(event) => changeItem(index, name, event.target.value)}
                    required={name === 'medication_name'}
                  />
                </label>
              ))}
              <label
                className="text-sm font-medium md:col-span-2"
                htmlFor={`rx-${index}-instructions`}
              >
                Instructions
                <Input
                  id={`rx-${index}-instructions`}
                  className="mt-2"
                  value={item.instructions}
                  onChange={(event) => changeItem(index, 'instructions', event.target.value)}
                />
              </label>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 text-sm text-teal"
          onClick={() => setItems((current) => [...current, { ...emptyLine }])}
        >
          Add medication
        </button>
      </div>
      <label className="text-sm font-medium" htmlFor="rx-instructions">
        General instructions
        <Textarea
          id="rx-instructions"
          className="mt-2"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white"
          disabled={saving}
        >
          Save draft
        </button>
        <Link
          href={initial ? `/app/prescriptions/${initial.id}` : `/app/patients/${patientId}`}
          className="rounded-md border border-line px-4 py-2 text-sm"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
