import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN;
if (!origin) throw new Error('Set SMOKE_ORIGIN');
const id = '00000000-0000-4000-8000-000000000001';
void test('clinical pages require a real session', async () => {
  for (const path of [
    '/app/doctors',
    '/app/doctors/new',
    `/app/doctors/${id}`,
    `/app/prescriptions/${id}`,
    `/app/patients/${id}/prescriptions/new`,
  ]) {
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
void test('clinical APIs deny unauthenticated requests and do not support hard deletion', async () => {
  for (const [path, method] of [
    ['/api/doctors', 'GET'],
    ['/api/doctors', 'POST'],
    ['/api/doctors/search', 'POST'],
    [`/api/doctors/${id}`, 'GET'],
    [`/api/doctors/${id}`, 'PATCH'],
    ['/api/prescriptions/search', 'POST'],
    [`/api/prescriptions/${id}`, 'GET'],
    [`/api/prescriptions/${id}`, 'PATCH'],
    [`/api/prescriptions/${id}/finalize`, 'POST'],
    [`/api/prescriptions/${id}/cancel`, 'POST'],
    [`/api/prescriptions/${id}/pdf`, 'GET'],
    [`/api/patients/${id}/prescriptions`, 'GET'],
    [`/api/patients/${id}/prescriptions`, 'POST'],
    ['/api/organization/branding', 'GET'],
    ['/api/organization/branding', 'PATCH'],
    ['/api/organization/branding/logo', 'GET'],
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
    '/api/doctors',
    `/api/doctors/${id}`,
    `/api/prescriptions/${id}`,
    `/api/patients/${id}/prescriptions`,
    '/api/organization/branding',
  ]) {
    const response: Response = await fetch(`${origin}${path}`, { method: 'DELETE' });
    assert.equal(response.status, 405, path);
  }
});
