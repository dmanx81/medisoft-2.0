import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultWorkList } from '../components/results/list';
import { ResultPanel } from '../components/results/panel';
import { OrderDetail } from '../components/orders/detail';
import type { LabOrder } from '../features/orders/types';
const order: LabOrder = {
  id: '00000000-0000-4000-8000-000000000010',
  organization_id: 'org',
  patient_id: '00000000-0000-4000-8000-000000000011',
  order_number: 'LAB-2026-000009',
  status: 'RECEIVED',
  priority: 'ROUTINE',
  ordered_at: '2026-09-11T10:00:00.000Z',
  ordered_by: 'user',
  ordered_by_name: 'Tech',
  ordering_physician_name: '',
  clinical_notes: '',
  fasting_status: 'FASTING',
  external_reference: '',
  cancellation_reason: '',
  cancelled_at: '',
  cancelled_by: '',
  cancelled_by_name: '',
  version: 4,
  created_by: 'user',
  updated_by: 'user',
  created_at: '2026-09-11T10:00:00.000Z',
  updated_at: '2026-09-11T10:00:00.000Z',
  patient_number: 'PAT-000005',
  patient_first_name: 'John',
  patient_last_name: 'Test',
  patient_status: 'ACTIVE',
  tests: [
    {
      id: '00000000-0000-4000-8000-000000000012',
      organization_id: 'org',
      order_id: '00000000-0000-4000-8000-000000000010',
      lab_test_id: '00000000-0000-4000-8000-000000000013',
      code_snapshot: 'GLU',
      name_snapshot: 'Glucose',
      short_name_snapshot: 'Glu',
      specimen_type_snapshot: 'SERUM',
      result_type_snapshot: 'NUMERIC',
      unit_symbol_snapshot: 'mg/dL',
      method_snapshot: 'Hexokinase',
      base_price_snapshot: '8.00',
      status: 'ACTIVE',
      created_at: '2026-09-11T10:00:00.000Z',
      created_by: 'user',
      covering_specimen_id: '00000000-0000-4000-8000-000000000014',
      covering_status: 'RECEIVED',
    },
  ],
  specimens: [],
  results: [],
  test_count: 1,
  covered_count: 1,
  received_count: 1,
};
void test('results worklist searches received orders', () => {
  const html = renderToStaticMarkup(
    <ResultWorkList
      initial={{ orders: [], total: 0, page: 1, pageSize: 20 }}
    />,
  );
  for (const text of [
    'Laboratory results',
    'Search received orders',
    'No received orders awaiting results',
    'Previous',
    'Next',
  ])
    assert.ok(html.includes(text), text);
});
void test('order detail shows result entry only when permitted', () => {
  const html = renderToStaticMarkup(
    <OrderDetail
      initial={order}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect={false}
      canReceive={false}
      canReject={false}
      canReadResults
      canEnterResults
      canValidateResults
      canVerifyResults={false}
      canAmendResults={false}
    />,
  );
  assert.ok(html.includes('Save result'));
  assert.ok(html.includes('Glucose'));
  assert.ok(html.includes('No result entered yet'));
  const readonly = renderToStaticMarkup(
    <OrderDetail
      initial={order}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect={false}
      canReceive={false}
      canReject={false}
      canReadResults
    />,
  );
  assert.ok(!readonly.includes('Save result'));
  assert.ok(!readonly.includes('Technically validate'));
});
void test('result panel shows frozen flag and hides values without read access', () => {
  const html = renderToStaticMarkup(
    <ResultPanel
      order={order}
      test={order.tests[0]}
      results={[
        {
          id: '00000000-0000-4000-8000-000000000015',
          organization_id: 'org',
          order_id: order.id,
          order_test_id: order.tests[0].id,
          status: 'ENTERED',
          result_type_snapshot: 'NUMERIC',
          numeric_value: '69',
          text_value: '',
          boolean_value: '',
          unit_symbol_snapshot: 'mg/dL',
          method_snapshot: 'Hexokinase',
          flag: 'LOW',
          reference_range_id: 'range',
          range_version_snapshot: '1',
          range_sex_snapshot: 'ANY',
          range_lower_snapshot: '70',
          range_upper_snapshot: '99',
          range_lower_operator_snapshot: 'GE',
          range_upper_operator_snapshot: 'LE',
          range_text_snapshot: '',
          range_unit_symbol_snapshot: 'mg/dL',
          range_method_snapshot: 'Hexokinase',
          critical_low_snapshot: '40',
          critical_high_snapshot: '450',
          entered_at: '2026-09-11T11:00:00.000Z',
          entered_by: 'user',
          entered_by_name: 'Tech',
          technically_validated_at: '',
          technically_validated_by: '',
          technically_validated_by_name: '',
          clinically_verified_at: '',
          clinically_verified_by: '',
          clinically_verified_by_name: '',
          amendment_reason: '',
          supersedes_id: '',
          successor_id: '',
          is_current: true,
          version: 1,
          created_at: '2026-09-11T11:00:00.000Z',
          created_by: 'user',
          updated_at: '2026-09-11T11:00:00.000Z',
          updated_by: 'user',
        },
      ]}
      canRead
      canEnter
      canValidate
      canVerify={false}
      canAmend={false}
      busy={false}
      onSave={() => undefined}
      onFailure={() => undefined}
      onBusy={() => undefined}
    />,
  );
  assert.ok(html.includes('69 mg/dL'));
  assert.ok(html.includes('Low'));
  assert.ok(html.includes('Technically validate'));
  assert.ok(html.includes('Update result'));
  const hidden = renderToStaticMarkup(
    <ResultPanel
      order={order}
      test={order.tests[0]}
      results={[]}
      canRead={false}
      canEnter={false}
      canValidate={false}
      canVerify={false}
      canAmend={false}
      busy={false}
      onSave={() => undefined}
      onFailure={() => undefined}
      onBusy={() => undefined}
    />,
  );
  assert.ok(hidden.includes('Result values are restricted for this role'));
  assert.ok(!hidden.includes('Save result'));
});
