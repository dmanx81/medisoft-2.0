import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderDetail } from '../components/orders/detail';
import { PublicReportAccess } from '../components/reports/public-access';
import type { LabOrder } from '../features/orders/types';
import type { LabReport } from '../features/reports/types';
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
  tests: [],
  specimens: [],
  results: [],
  reports: [],
  test_count: 1,
  covered_count: 1,
  received_count: 1,
};
const current: LabReport = {
  id: '00000000-0000-4000-8000-000000000021',
  organization_id: 'org',
  order_id: order.id,
  patient_id: order.patient_id,
  report_number: 'LAB-2026-000009-R2',
  report_version: 2,
  status: 'ISSUED',
  issued_at: '2026-09-13T10:00:00.000Z',
  issued_by: 'user',
  issued_by_name: 'Biochemist',
  supersedes_id: '00000000-0000-4000-8000-000000000020',
  successor_id: '',
  is_current: true,
  version: 1,
  created_at: '2026-09-13T10:00:00.000Z',
  created_by: 'user',
  updated_at: '2026-09-13T10:00:00.000Z',
  updated_by: 'user',
};
const previous: LabReport = {
  ...current,
  id: '00000000-0000-4000-8000-000000000020',
  report_number: 'LAB-2026-000009-R1',
  report_version: 1,
  status: 'SUPERSEDED',
  is_current: false,
  supersedes_id: '',
  successor_id: current.id,
};
void test('share controls appear only for authorized roles and name the report version', () => {
  const authorized = renderToStaticMarkup(
    <OrderDetail
      initial={{ ...order, reports: [previous, current] }}
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
      canShareReports
      canRevokeReportShares
    />,
  );
  assert.ok(authorized.includes('LAB-2026-000009-R2'));
  assert.ok(authorized.includes('LAB-2026-000009-R1'));
  assert.ok(authorized.includes('Create secure link'));
  assert.ok(authorized.includes('24 hours'));
  assert.ok(authorized.includes('3 days'));
  assert.ok(authorized.includes('previous version'));
  assert.ok(!authorized.includes('latest report'));
  const doctor = renderToStaticMarkup(
    <OrderDetail
      initial={{ ...order, reports: [current] }}
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
      canShareReports={false}
      canRevokeReportShares={false}
    />,
  );
  assert.ok(doctor.includes('LAB-2026-000009-R2'));
  assert.ok(!doctor.includes('Create secure link'));
});
void test('stale superseded reports cannot create a new current patient link', () => {
  const stale: LabReport = {
    ...previous,
    successor_id: '',
  };
  const html = renderToStaticMarkup(
    <OrderDetail
      initial={{ ...order, status: 'IN_PROCESS', reports: [stale] }}
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
      canShareReports
      canRevokeReportShares
    />,
  );
  assert.ok(html.includes('no longer current'));
  assert.ok(html.includes('replacement report'));
  assert.ok(!html.includes('Create secure link'));
});
void test('public report-access states stay generic and snapshot-only', () => {
  const unavailable = renderToStaticMarkup(
    <PublicReportAccess token={'a'.repeat(64)} initial={{ status: 'unavailable' }} />,
  );
  assert.ok(unavailable.includes('Report link unavailable'));
  assert.ok(unavailable.includes('may have expired or been revoked'));
  assert.ok(!unavailable.includes('report ID'));
  assert.ok(!unavailable.includes('permission denied'));
  const verify = renderToStaticMarkup(
    <PublicReportAccess token={'b'.repeat(64)} initial={{ status: 'verify' }} />,
  );
  assert.ok(verify.includes('Verify access'));
  assert.ok(verify.includes('Access PIN'));
  assert.ok(!verify.includes('/report-access/'));
  const ready = renderToStaticMarkup(
    <PublicReportAccess
      token={'c'.repeat(64)}
      initial={{
        status: 'ready',
        view: {
          organization_name: 'Example Lab',
          organization_address: '1 Lab Street',
          organization_phone: '',
          organization_email: '',
          report_number: 'LAB-2026-000009-R1',
          report_version: 1,
          issued_at: '2026-09-12T10:00:00.000Z',
          issued_by_name: 'Biochemist',
          patient_name: 'John Test',
          patient_number: 'PAT-000005',
          order_number: 'LAB-2026-000009',
          status: 'SUPERSEDED',
          superseded: true,
        },
      }}
    />,
  );
  assert.ok(ready.includes('LAB-2026-000009-R1'));
  assert.ok(ready.includes('v1'));
  assert.ok(ready.includes('John Test'));
  assert.ok(ready.includes('Download official PDF'));
  assert.ok(ready.includes('no longer the current official version'));
  assert.ok(ready.includes('/api/public/reports/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/pdf'));
  assert.ok(ready.includes('noreferrer'));
});
