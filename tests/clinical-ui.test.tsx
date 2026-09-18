import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DoctorsList } from '../components/clinical/doctors-list';
import { PrescriptionDetail } from '../components/clinical/prescription-detail';
import { PatientPrescriptions } from '../components/clinical/patient-prescriptions';
import { BrandingForm } from '../components/clinical/branding-form';
import { TemplatesList } from '../components/clinical/templates-list';
import { TemplatePicker } from '../components/clinical/template-picker';
import { PatientDetail } from '../components/patients/detail';
import { emptyPatient } from '../features/patients/validation';
import type { ClinicalDoctor, ClinicalPrescription, PrescriptionTemplate } from '../features/clinical/types';
import type { Patient } from '../features/patients/types';

const patient: Patient = {
  ...emptyPatient,
  first_name: 'Ada',
  last_name: 'Patient',
  id: '00000000-0000-4000-8000-000000000001',
  organization_id: 'org',
  patient_number: 'PAT-000001',
  version: 1,
  created_at: '2026-09-16',
  updated_at: '2026-09-16',
  created_by: 'user',
  updated_by: 'user',
};

const doctor: ClinicalDoctor = {
  id: '00000000-0000-4000-8000-000000000002',
  organization_id: 'org',
  user_id: '00000000-0000-4000-8000-000000000003',
  first_name: 'Elena',
  last_name: 'Hoxha',
  display_name: 'Dr Elena Hoxha',
  title: 'Dr',
  specialty: 'Internal medicine',
  license_number: 'LIC-100',
  phone: '',
  email: 'elena@example.test',
  qualifications: '',
  department: '',
  signature_asset_id: '',
  status: 'ACTIVE',
  version: 1,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-09-16',
  updated_at: '2026-09-16',
};

const prescription: ClinicalPrescription = {
  id: '00000000-0000-4000-8000-000000000004',
  organization_id: 'org',
  patient_id: patient.id,
  doctor_id: doctor.id,
  status: 'FINALIZED',
  prescription_number: 'RX-2026-000001',
  prescribed_on: '2026-09-16',
  clinical_note: '',
  instructions: '',
  source_template_id: '',
  version: 2,
  finalized_at: '2026-09-16T10:00:00.000Z',
  finalized_by: 'user',
  cancelled_at: '',
  cancelled_by: '',
  cancellation_reason: '',
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-09-16',
  updated_at: '2026-09-16',
  patient_display: 'Ada Patient',
  patient_number: 'PAT-000001',
  doctor_display: 'Dr Elena Hoxha',
  items: [
    {
      id: '00000000-0000-4000-8000-000000000005',
      sort_order: 1,
      medication_name: 'Amoxicillin',
      strength: '500 mg',
      form: 'Capsule',
      dose: '1 capsule',
      route: 'Oral',
      frequency: '3 times daily',
      duration: '7 days',
      quantity: '21 capsules',
      instructions: 'Take after food',
    },
  ],
};

void test('doctors list and form follow existing clinical administration patterns', () => {
  const html = renderToStaticMarkup(
    <DoctorsList
      initial={{ doctors: [], total: 0, page: 1, pageSize: 20 }}
      canManage
    />,
  );
  assert.ok(html.includes('Search doctors'));
  assert.ok(html.includes('New doctor'));
  const readonly = renderToStaticMarkup(
    <DoctorsList
      initial={{ doctors: [], total: 0, page: 1, pageSize: 20 }}
      canManage={false}
    />,
  );
  assert.ok(!readonly.includes('href="/app/doctors/new"'));
});

void test('prescription workflow exposes medications and A5 print actions', () => {
  const detail = renderToStaticMarkup(
    <PrescriptionDetail
      prescription={prescription}
      canFinalize
      canCancel
      canCreate
      canDownload
    />,
  );
  assert.ok(detail.includes('RX-2026-000001'));
  assert.ok(detail.includes('Amoxicillin'));
  assert.ok(detail.includes('Preview'));
  assert.ok(detail.includes('Print'));
  assert.ok(detail.includes('Download PDF'));
  assert.ok(detail.includes('/api/clinical-prescriptions/'));
});

void test('cancelled prescriptions do not expose print or download actions', () => {
  const html = renderToStaticMarkup(
    <PrescriptionDetail
      prescription={{
        ...prescription,
        status: 'CANCELLED',
        cancelled_at: '2026-09-16T12:00:00.000Z',
        cancelled_by: 'user',
        cancellation_reason: 'Therapy changed',
      }}
      canFinalize
      canCancel
      canCreate
      canDownload
    />,
  );
  assert.ok(html.includes('Cancelled'));
  assert.equal(html.includes('Preview'), false);
  assert.equal(html.includes('Download PDF'), false);
  assert.equal(html.includes('href="/api/clinical-prescriptions/'), false);
});

void test('patient record prescriptions tab and branding form stay in the existing design', () => {
  const html = renderToStaticMarkup(
    <PatientDetail
      patient={patient}
      canActivity={false}
      canReadPrescriptions
      canCreatePrescriptions
    />,
  );
  assert.ok(html.includes('Prescriptions'));
  const history = renderToStaticMarkup(
    <PatientPrescriptions patientId={patient.id} canCreate />,
  );
  assert.ok(history.includes('New prescription'));
  const branding = renderToStaticMarkup(
    <BrandingForm
      initial={{
        name: 'Care',
        legal_name: 'Care Centre',
        address: '1 Care Street',
        city: 'Tirana',
        postal_code: '1001',
        country: 'AL',
        phone: '',
        email: '',
        website: '',
        registration_number: '',
        has_logo: false,
      }}
    />,
  );
  assert.ok(branding.includes('Clinical document branding'));
  assert.ok(branding.includes('Upload logo'));
});

const template: PrescriptionTemplate = {
  id: '00000000-0000-4000-8000-000000000006',
  organization_id: 'org',
  name: 'Acute Tonsillitis',
  description: 'First-line therapy',
  category: 'ENT',
  is_active: true,
  version: 1,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-09-17',
  updated_at: '2026-09-17',
  item_count: 2,
  items: [
    {
      id: '00000000-0000-4000-8000-000000000007',
      sort_order: 1,
      medication_name: 'Amoxicillin',
      strength: '500 mg',
      form: 'Capsule',
      dose: '1 capsule',
      route: 'Oral',
      frequency: '3 times daily',
      duration: '7 days',
      quantity: '21 capsules',
      instructions: 'After food',
    },
    {
      id: '00000000-0000-4000-8000-000000000008',
      sort_order: 2,
      medication_name: 'Paracetamol',
      strength: '500 mg',
      form: 'Tablet',
      dose: '1 tablet',
      route: 'Oral',
      frequency: 'As needed',
      duration: '',
      quantity: '',
      instructions: 'Maximum 3/day',
    },
  ],
};

void test('prescription template management follows existing clinical administration patterns', () => {
  const html = renderToStaticMarkup(
    <TemplatesList
      initial={{ templates: [template], total: 1, page: 1, pageSize: 20 }}
      canManage
    />,
  );
  assert.ok(html.includes('Search templates'));
  assert.ok(html.includes('New template'));
  assert.ok(html.includes('Acute Tonsillitis'));
  assert.ok(html.includes('ENT'));
  const readonly = renderToStaticMarkup(
    <TemplatesList
      initial={{ templates: [], total: 0, page: 1, pageSize: 20 }}
      canManage={false}
    />,
  );
  assert.ok(!readonly.includes('href="/app/prescription-templates/new"'));
  const picker = renderToStaticMarkup(
    <TemplatePicker onApply={() => undefined} />,
  );
  assert.ok(picker.includes('Use template'));
});
