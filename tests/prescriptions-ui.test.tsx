import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DoctorList } from '../components/doctors/list';
import { PrescriptionDetail } from '../components/prescriptions/detail';
import { PatientDetail } from '../components/patients/detail';
import { emptyPatient } from '../features/patients/validation';
import type { Patient } from '../features/patients/types';
import type { Prescription } from '../features/prescriptions/types';
void test('doctor list exposes search and create controls', () => {
  const html = renderToStaticMarkup(
    <DoctorList
      initial={{ doctors: [], total: 0, page: 1, pageSize: 20 }}
      canManage
    />,
  );
  for (const text of ['Doctors', 'Search doctors', 'New doctor', 'No doctors found'])
    assert.ok(html.includes(text), text);
});
void test('prescription detail offers preview print download and finalize', () => {
  const prescription: Prescription = {
    id: '00000000-0000-4000-8000-000000000040',
    organization_id: 'org',
    patient_id: '00000000-0000-4000-8000-000000000041',
    doctor_id: '00000000-0000-4000-8000-000000000042',
    prescription_number: '',
    status: 'DRAFT',
    prescription_date: '2026-09-16',
    clinical_note: '',
    general_instructions: '',
    finalized_at: '',
    finalized_by: '',
    finalized_by_name: '',
    cancelled_at: '',
    cancelled_by: '',
    cancelled_by_name: '',
    cancellation_reason: '',
    created_at: '2026-09-16',
    updated_at: '2026-09-16',
    created_by: 'user',
    updated_by: 'user',
    version: 1,
    snapshot: {},
    patient_number: 'PAT-000001',
    patient_first_name: 'Ana',
    patient_last_name: 'Test',
    doctor_display_name: 'Dr Ada',
    items: [
      {
        id: 'item',
        organization_id: 'org',
        prescription_id: '00000000-0000-4000-8000-000000000040',
        sort_order: 0,
        medication_name: 'Amoxicillin',
        strength: '500 mg',
        form: 'Capsule',
        dose: '1',
        route: 'Oral',
        frequency: 'TID',
        duration: '7 days',
        quantity: '21',
        instructions: 'After food',
      },
    ],
  };
  const html = renderToStaticMarkup(
    <PrescriptionDetail
      initial={prescription}
      canFinalize
      canCancel
      canEditDraft
      canDownload
    />,
  );
  for (const text of [
    'Draft prescription',
    'Amoxicillin',
    'Preview',
    'Print',
    'Download PDF',
    'Finalize / sign',
    '/api/prescriptions/00000000-0000-4000-8000-000000000040/pdf',
  ])
    assert.ok(html.includes(text), text);
});
void test('patient detail includes a prescriptions section', () => {
  const patient: Patient = {
    ...emptyPatient,
    first_name: 'Synthetic',
    last_name: 'Example',
    id: '00000000-0000-4000-8000-000000000001',
    organization_id: 'test',
    patient_number: 'PAT-000001',
    version: 1,
    created_at: '2026-09-10',
    updated_at: '2026-09-10',
    created_by: 'test',
    updated_by: 'test',
  };
  const html = renderToStaticMarkup(
    <PatientDetail
      patient={patient}
      canActivity={false}
      canReadPrescriptions
      canCreatePrescriptions
    />,
  );
  assert.ok(html.includes('Prescriptions'));
  assert.ok(html.includes('New prescription'));
});
