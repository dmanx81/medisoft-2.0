import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN;
if (!origin) throw new Error('Set SMOKE_ORIGIN');
void test('health and readiness are public, cache-free and do not leak configuration', async () => {
  const health: Response = await fetch(`${origin}/api/health`);
  const healthBody = (await health.json()) as Record<string, unknown>;
  assert.equal(health.status, 200);
  assert.equal(healthBody.status, 'ok');
  assert.equal('DATABASE_URL' in healthBody, false);
  assert.equal('APP_ORIGIN' in healthBody, false);
  assert.ok(health.headers.get('cache-control')?.includes('no-store'));
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  const ready: Response = await fetch(`${origin}/api/ready`);
  const readyBody = (await ready.json()) as Record<string, unknown>;
  assert.equal(ready.status, 200, JSON.stringify(readyBody));
  assert.equal(readyBody.status, 'ready');
  assert.equal(Object.keys(readyBody).join(','), 'status');
  const head = await fetch(`${origin}/api/health`, { method: 'HEAD' });
  assert.equal(head.status, 200);
});
void test('authenticated and login responses carry production security headers', async () => {
  for (const path of ['/login', '/app', '/api/health']) {
    const response: Response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', path);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
    assert.match(
      response.headers.get('content-security-policy') ?? '',
      /frame-ancestors 'none'/,
      path,
    );
    assert.match(
      response.headers.get('permissions-policy') ?? '',
      /camera=\(\)/,
      path,
    );
    const cache = (response.headers.get('cache-control') ?? '').toLowerCase();
    assert.ok(
      cache.includes('no-store') || cache.includes('no-cache'),
      `${path} cache-control=${cache}`,
    );
    assert.equal(response.headers.get('strict-transport-security'), null, path);
  }
});
