import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN;
if (!origin) throw new Error('Set SMOKE_ORIGIN');
const id = '00000000-0000-4000-8000-000000000001';
void test('order pages require a real session', async () => {
  for (const path of [
    '/app/laboratory/orders/new',
    `/app/laboratory/orders/${id}`,
  ]) {
    const response: Response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: {
        cookie: 'medisoft_session=forged',
        'x-organization-id': id,
        'x-role': 'ORG_ADMIN',
      },
    });
    assert.equal(response.status, 307);
    assert.equal(
      new URL(response.headers.get('location')!, origin).pathname,
      '/login',
    );
  }
});
void test('order APIs deny unauthenticated requests and do not support hard deletion', async () => {
  for (const [path, method] of [
    ['/api/lab-orders', 'POST'],
    ['/api/lab-orders/search', 'POST'],
    [`/api/lab-orders/${id}`, 'GET'],
    [`/api/lab-orders/${id}`, 'PATCH'],
    [`/api/lab-orders/${id}/place`, 'POST'],
    [`/api/lab-orders/${id}/cancel`, 'POST'],
    [`/api/lab-orders/${id}/tests`, 'POST'],
    [`/api/lab-orders/${id}/specimens`, 'POST'],
    [`/api/lab-orders/${id}/activity`, 'GET'],
    [`/api/lab-specimens/${id}/receive`, 'POST'],
    [`/api/lab-specimens/${id}/reject`, 'POST'],
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
  for (const path of [`/api/lab-orders/${id}`, `/api/lab-specimens/${id}`]) {
    const response: Response = await fetch(`${origin}${path}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 405, path);
  }
});
