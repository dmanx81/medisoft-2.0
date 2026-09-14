import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN;
if (!origin) throw new Error('Set SMOKE_ORIGIN');
const id = '00000000-0000-4000-8000-000000000001';
void test('billing pages require a real session', async () => {
  for (const path of ['/app/billing', `/app/billing/${id}`]) {
    const response: Response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: {
        cookie: 'medisoft_session=forged',
        'x-organization-id': id,
        'x-role': 'ORG_ADMIN',
      },
    });
    assert.equal(response.status, 307, path);
    assert.equal(
      new URL(response.headers.get('location')!, origin).pathname,
      '/login',
      path,
    );
  }
});
void test('billing APIs deny unauthenticated requests and do not support hard deletion', async () => {
  for (const [path, method] of [
    ['/api/lab-invoices/search', 'POST'],
    [`/api/lab-orders/${id}/invoices`, 'POST'],
    [`/api/lab-orders/${id}/invoice-context`, 'GET'],
    [`/api/lab-invoices/${id}`, 'GET'],
    [`/api/lab-invoices/${id}`, 'PATCH'],
    [`/api/lab-invoices/${id}/issue`, 'POST'],
    [`/api/lab-invoices/${id}/cancel`, 'POST'],
    [`/api/lab-invoices/${id}/pdf`, 'GET'],
    [`/api/lab-invoices/${id}/payments`, 'GET'],
    [`/api/lab-invoices/${id}/payments`, 'POST'],
  ]) {
    const response: Response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        'Content-Type': 'application/json',
        cookie: 'medisoft_session=invalid',
      },
      ...(method === 'POST' || method === 'PATCH' ? { body: '{}' } : {}),
    });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));
    assert.equal(
      ((await response.json()) as { code: string }).code,
      'UNAUTHENTICATED',
    );
  }
  for (const path of [
    `/api/lab-invoices/${id}`,
    `/api/lab-orders/${id}/invoices`,
    `/api/lab-invoices/${id}/payments`,
  ]) {
    const response: Response = await fetch(`${origin}${path}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 405, path);
  }
});
