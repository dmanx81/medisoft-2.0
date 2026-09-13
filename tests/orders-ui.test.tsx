import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderList } from '../components/orders/list';
import { OrderDetail } from '../components/orders/detail';
import type { LabOrder } from '../features/orders/types';
void test('order list is searchable and hides create for read-only roles', () => {
  const html = renderToStaticMarkup(
    <OrderList
      initial={{ orders: [], total: 0, page: 1, pageSize: 20 }}
      canCreate
    />,
  );
  for (const text of [
    'Search orders',
    'New order',
    'No orders found',
    'Priority',
    'Previous',
    'Next',
  ])
    assert.ok(html.includes(text), text);
  const readonly = renderToStaticMarkup(
    <OrderList
      initial={{ orders: [], total: 0, page: 1, pageSize: 20 }}
      canCreate={false}
    />,
  );
  assert.ok(!readonly.includes('href="/app/laboratory/orders/new"'));
});
void test('order detail shows collection actions only when permitted', () => {
  const order: LabOrder = {
    id: '00000000-0000-4000-8000-000000000010',
    organization_id: 'org',
    patient_id: '00000000-0000-4000-8000-000000000011',
    order_number: 'LAB-2026-000001',
    status: 'ORDERED',
    priority: 'URGENT',
    ordered_at: '2026-09-10T10:00:00.000Z',
    ordered_by: 'user',
    ordered_by_name: 'Tech',
    ordering_physician_name: '',
    clinical_notes: 'Fasting sample',
    fasting_status: 'FASTING',
    external_reference: '',
    cancellation_reason: '',
    cancelled_at: '',
    cancelled_by: '',
    cancelled_by_name: '',
    version: 2,
    created_by: 'user',
    updated_by: 'user',
    created_at: '2026-09-10T10:00:00.000Z',
    updated_at: '2026-09-10T10:00:00.000Z',
    patient_number: 'PAT-000001',
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
        created_at: '2026-09-10T10:00:00.000Z',
        created_by: 'user',
        covering_specimen_id: '',
        covering_status: '',
      },
    ],
    specimens: [],
    results: [],
    reports: [],
    test_count: 1,
    covered_count: 0,
    received_count: 0,
  };
  const html = renderToStaticMarkup(
    <OrderDetail
      initial={order}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect
      canReceive
      canReject
    />,
  );
  assert.ok(html.includes('John'));
  assert.ok(html.includes('LAB-2026-000001'));
  assert.ok(html.includes('Ordered'));
  assert.ok(html.includes('Urgent'));
  assert.ok(html.includes('Collect specimen'));
  assert.ok(html.includes('Glucose'));
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
    />,
  );
  assert.ok(!readonly.includes('Collect specimen'));
  assert.ok(!readonly.includes('Cancel order'));
  const received = renderToStaticMarkup(
    <OrderDetail
      initial={{ ...order, status: 'RECEIVED' }}
      activity={[]}
      canEdit={false}
      canPlace={false}
      canCancel={false}
      canCollect
      canReceive
      canReject
    />,
  );
  assert.ok(received.includes('Received'));
  assert.ok(!received.includes('Partially collected'));
  assert.ok(!received.includes('Collect specimen'));
});
