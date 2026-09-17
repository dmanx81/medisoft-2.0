import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard } from '../components/application/dashboard';
import { navigation } from '../components/application/navigation';
import { demoOrders } from '../features/dashboard/demo';
import { can } from '../lib/auth/permissions';
void test('dashboard renders accessible headings, metrics, table and explicit empty state', () => {
  const html = renderToStaticMarkup(
    <Dashboard demo={false} metrics={[0, 0, 0, 0, 0]} orders={[]} />,
  );
  for (const text of [
    'Laboratory dashboard',
    'Today’s Patients',
    'Awaiting Validation',
    'Completed Today',
    'Recent Laboratory Orders',
    'Your workspace is ready',
    '<table',
    '<caption',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes('DEMO-'));
});
void test('synthetic workflow statuses and development disclosure are visible', () => {
  const html = renderToStaticMarkup(
    <Dashboard demo metrics={[12, 5, 3, 1, 1]} orders={demoOrders} />,
  );
  for (const text of [
    'Development preview',
    'New',
    'Collected',
    'Processing',
    'Awaiting validation',
    'Completed',
  ])
    assert.ok(html.includes(text));
});
void test('application navigation has unique protected routes and least-privilege visibility', () => {
  assert.equal(new Set(navigation.map((n) => n.href)).size, 12);
  assert.deepEqual(
    navigation.filter((n) => can('VIEWER', n.permission)).map((n) => n.label),
    ['Dashboard'],
  );
  for (const item of navigation)
    assert.ok(item.href === '/app' || item.href.startsWith('/app/'));
});

void test('application shell includes organization, identity, sign-out and restricted navigation', async () => {
  const { ApplicationShell } = await import('../components/application/shell');
  const html = renderToStaticMarkup(
    <ApplicationShell
      name="Test Viewer"
      organizationName="Test Clinic"
      userRole="VIEWER"
    >
      <p>Workspace content</p>
    </ApplicationShell>,
  );
  for (const text of [
    'MEDISOFT',
    'Test Clinic',
    'Test Viewer',
    'Skip to workspace',
    'Workspace content',
    '/api/auth/logout',
    'Dashboard',
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes('href="/app/billing"'));
  assert.ok(!html.includes('href="/app/management/users"'));
});
