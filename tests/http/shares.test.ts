import test from 'node:test';
import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN;
if (!origin) throw new Error('Set SMOKE_ORIGIN');
const id = '00000000-0000-4000-8000-000000000001';
const token = 'a'.repeat(64);
void test('public report-access pages do not require a staff session', async () => {
  const response: Response = await fetch(`${origin}/report-access/${token}`, {
    redirect: 'manual',
    headers: {
      cookie: 'medisoft_session=forged',
      'x-organization-id': id,
      'x-role': 'ORG_ADMIN',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.match(
    response.headers.get('cache-control') || '',
    /no-store|no-cache/i,
  );
  assert.ok(response.headers.get('x-robots-tag')?.includes('noindex'));
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const html = await response.text();
  assert.ok(html.includes('unavailable'));
  assert.ok(!html.includes(id));
  assert.ok(!html.includes('Please sign in'));
});
void test('internal share APIs deny unauthenticated access and public PDFs stay generic', async () => {
  for (const [path, method] of [
    [`/api/lab-reports/${id}/shares`, 'GET'],
    [`/api/lab-reports/${id}/shares`, 'POST'],
    [`/api/lab-report-shares/${id}/revoke`, 'POST'],
  ]) {
    const response: Response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        'Content-Type': 'application/json',
        cookie: 'medisoft_session=invalid',
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));
    assert.equal(
      ((await response.json()) as { code: string }).code,
      'UNAUTHENTICATED',
    );
  }
  const deleted: Response = await fetch(`${origin}/api/lab-reports/${id}/shares`, {
    method: 'DELETE',
  });
  assert.equal(deleted.status, 405);
  const pdf: Response = await fetch(`${origin}/api/public/reports/${token}/pdf`, {
    redirect: 'manual',
  });
  assert.equal(pdf.status, 404);
  assert.ok(pdf.headers.get('cache-control')?.includes('no-store'));
  assert.ok(pdf.headers.get('x-robots-tag')?.includes('noindex'));
  assert.equal(pdf.headers.get('location'), null);
  const body = (await pdf.json()) as { code: string; message: string };
  assert.equal(body.code, 'SHARE_UNAVAILABLE');
  assert.ok(body.message.includes('unavailable'));
  assert.ok(!body.message.toLowerCase().includes('permission denied'));
  assert.ok(!body.message.toLowerCase().includes('report id'));
});
void test('robots.txt excludes public report-access URLs', async () => {
  const response: Response = await fetch(`${origin}/robots.txt`);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.includes('Disallow: /report-access/'));
  assert.ok(text.includes('Disallow: /api/public/'));
});
