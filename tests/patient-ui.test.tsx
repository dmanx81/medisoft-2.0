import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { PatientList } from '../components/patients/list';
import { PatientDetail } from '../components/patients/detail';
import { emptyPatient } from '../features/patients/validation';
import type { Patient } from '../features/patients/types';
void test('patient list has accessible lookup controls and no national IDs in list output', () => {
  const html = renderToStaticMarkup(
    <PatientList
      initial={{ patients: [], total: 0, page: 1, pageSize: 20 }}
      canCreate
    />,
  );
  for (const text of [
    'Search patients',
    'New patient',
    'No patients found',
    'Date of birth',
    'Previous',
    'Next',
  ])
    assert.ok(html.includes(text));
  assert.ok(!html.includes('method="get"'));
  assert.ok(html.includes('type="search"'));
  const readonly = renderToStaticMarkup(
    <PatientList
      initial={{ patients: [], total: 0, page: 1, pageSize: 20 }}
      canCreate={false}
    />,
  );
  assert.ok(!readonly.includes('href="/app/patients/new"'));
});
void test('detail reserves future modules without exposing activity to unauthorized roles', () => {
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
    <PatientDetail patient={patient} canActivity={false} />,
  );
  for (const text of [
    'Overview',
    'Lab Orders',
    'Results',
    'Prescriptions',
    'Documents',
    'Billing',
  ])
    assert.ok(html.includes(text));
  assert.ok(!html.includes('>Activity<'));
});
