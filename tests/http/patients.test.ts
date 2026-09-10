import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN;
if (!origin) throw new Error('Set SMOKE_ORIGIN');
const id = '00000000-0000-4000-8000-000000000001';
void test('patient pages require a real session', async () => {
  for (const path of [
    '/app/patients/new',
    `/app/patients/${id}`,
    `/app/patients/${id}/edit`,
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
void test('patient APIs deny unauthenticated requests and do not support hard deletion', async () => {
  for (const [path, method] of [
    ['/api/patients', 'POST'],
    ['/api/patients/search', 'POST'],
    [`/api/patients/${id}`, 'GET'],
    [`/api/patients/${id}`, 'PATCH'],
    [`/api/patients/${id}/activity`, 'GET'],
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
  const response: Response = await fetch(`${origin}/api/patients/${id}`, {
    method: 'DELETE',
  });
  assert.equal(response.status, 405);
});
