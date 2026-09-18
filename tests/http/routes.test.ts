import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN;
if (!origin)
  throw new Error('Set SMOKE_ORIGIN to a running local MEDISOFT server');
void test('all application routes redirect anonymous and forged-cookie requests to login', async () => {
  for (const path of [
    '/app',
    '/app/patients',
    '/app/laboratory/orders',
    '/app/laboratory/samples',
    '/app/laboratory/results',
    '/app/reports',
    '/app/doctors',
    '/app/prescription-templates',
    '/app/billing',
    '/app/management/tests',
    '/app/management/users',
    '/app/settings',
  ]) {
    const response: Response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: {
        cookie: 'medisoft_session=forged',
        'x-organization-id': 'attacker',
        'x-user-role': 'PLATFORM_ADMIN',
      },
    });
    assert.equal(response.status, 307, path);
    assert.equal(
      new URL(response.headers.get('location')!, origin).pathname,
      '/login',
      path,
    );
    assert.ok(!(await response.text()).includes('Recent Laboratory Orders'));
  }
});
void test('English, Albanian, demos and login remain public', async () => {
  for (const path of ['/en', '/sq', '/en/demo', '/sq/demo', '/login']) {
    const response: Response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200, path);
  }
});
void test('authentication endpoints reject CSRF, oversized requests and invalid inputs', async () => {
  for (const path of ['/api/auth/login', '/api/auth/logout']) {
    const response: Response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { origin: 'https://untrusted.example' },
      redirect: 'manual',
    });
    assert.equal(response.status, 403, path);
  }
  const bad = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=invalid&password=',
    redirect: 'manual',
  });
  assert.equal(bad.status, 303);
  assert.equal(
    new URL(bad.headers.get('location')!, origin).pathname,
    '/login',
  );
  assert.equal(bad.headers.get('set-cookie'), null);
  const oversized = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'password=' + 'a'.repeat(4096),
    redirect: 'manual',
  });
  assert.equal(oversized.status, 413);
});
