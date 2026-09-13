import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportList } from '../components/reports/list';
import { OrderDetail } from '../components/orders/detail';
import type { LabOrder } from '../features/orders/types';
const order: LabOrder = {
  id: '00000000-0000-4000-8000-000000000010',
  organization_id: 'org',
  patient_id: '00000000-0000-4000-8000-000000000011',
  order_number: 'LAB-2026-000009',
  status: 'COMPLETED',
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
  version: 6,
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
  reports: [],
  test_count: 1,
  covered_count: 1,
  received_count: 1,
};
const report = {
  id: '00000000-0000-4000-8000-000000000020',
  organization_id: 'org',
  order_id: order.id,
  patient_id: order.patient_id,
  report_number: 'LAB-2026-000009-R1',
  report_version: 1,
  status: 'ISSUED',
  issued_at: '2026-09-12T10:00:00.000Z',
  issued_by: 'user',
  issued_by_name: 'Biochemist',
  supersedes_id: '',
  successor_id: '',
  is_current: true,
  version: 1,
  created_at: '2026-09-12T10:00:00.000Z',
  created_by: 'user',
  updated_at: '2026-09-12T10:00:00.000Z',
  updated_by: 'user',
};
void test('reports worklist searches issued reports', () => {
  const html = renderToStaticMarkup(
    <ReportList
      initial={{ reports: [], total: 0, page: 1, pageSize: 20 }}
      canDownload
    />,
  );
  for (const text of [
    'Laboratory reports',
    'Search reports',
    'No issued laboratory reports',
    'frozen snapshot',
    'Previous',
    'Next',
  ])
    assert.ok(html.includes(text), text);
});
});
void test('completed orders show generate report controls by permission', () => {
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
      canReadReports
      canGenerateReports
      canDownloadReports
      canDeliverReports
    />,
  );
  assert.ok(html.includes('Completed'));
  assert.ok(html.includes('clinically complete'));
  assert.ok(html.includes('Generate official report'));
  const incomplete = renderToStaticMarkup(
    <OrderDetail
      initial={{ ...order, status: 'IN_PROCESS' }}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect={false}
      canReceive={false}
      canReject={false}
      canReadReports
      canGenerateReports
      canDownloadReports
    />,
  );
  assert.ok(!incomplete.includes('Generate official report'));
  assert.ok(
    incomplete.includes(
      'An official report can be issued after every active ordered test is',
    ),
  );
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
      canReadReports
      canGenerateReports={false}
      canDownloadReports
    />,
  );
  assert.ok(!readonly.includes('Generate official report'));
});
void test('report history remains downloadable and flags later amendments', () => {
  const html = renderToStaticMarkup(
    <OrderDetail
      initial={{ ...order, reports: [report] }}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect={false}
      canReceive={false}
      canReject={false}
      canReadReports
      canGenerateReports
      canDownloadReports
      canDeliverReports
    />,
  );
  assert.ok(html.includes('Report history'));
  assert.ok(html.includes('LAB-2026-000009-R1'));
  assert.ok(html.includes('v1'));
  assert.ok(html.includes('Download PDF'));
  assert.ok(html.includes('/api/lab-reports/00000000-0000-4000-8000-000000000020/pdf'));
  const amended = renderToStaticMarkup(
    <OrderDetail
      initial={{ ...order, status: 'IN_PROCESS', reports: [report] }}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect={false}
      canReceive={false}
      canReject={false}
      canReadReports
      canGenerateReports
      canDownloadReports
    />,
  );
  assert.ok(amended.includes('A result was amended after the current report'));
  assert.ok(!amended.includes('Generate official report'));
});
