import test from 'node:test';
import assert from 'node:assert/strict';
import { can, authorize, roles, type Principal } from '../lib/auth/permissions';
import { organizationScope, assertOrganization } from '../lib/db/tenant';
import {
  loginSchema,
  organizationSchema,
  requestOriginHeaders,
  validOrigin,
  validRequestOrigin,
  validSessionToken,
} from '../lib/validation';
import { parseEnvironment } from '../lib/env';
import {
  hashPassword,
  verifyPassword,
  newSession,
  digest,
} from '../lib/auth/password';
const principal: Principal = {
  userId: 'user-a',
  organizationId: 'org-a',
  role: 'VIEWER',
  name: 'Test',
  organizationName: 'Test',
  sessionHash: 'hash',
};
void test('roles deny privileges by default and permit only named grants', () => {
  for (const role of roles) assert.equal(can(role, 'dashboard:read'), true);
  assert.equal(can('RECEPTIONIST', 'results:read'), false);
  assert.equal(can('LAB_TECHNICIAN', 'billing:read'), false);
  assert.equal(can('RECEPTIONIST', 'billing:create'), true);
  assert.equal(can('RECEPTIONIST', 'billing:issue'), true);
  assert.equal(can('RECEPTIONIST', 'billing:payment-record'), true);
  assert.equal(can('RECEPTIONIST', 'billing:cancel'), false);
  assert.equal(can('RECEPTIONIST', 'billing:correct'), false);
  assert.equal(can('RECEPTIONIST', 'billing:settings'), false);
  assert.equal(can('RECEPTIONIST', 'billing:email'), true);
  assert.equal(can('ORG_ADMIN', 'billing:correct'), true);
  assert.equal(can('ORG_ADMIN', 'billing:settings'), true);
  assert.equal(can('BIOCHEMIST', 'billing:read'), true);
  assert.equal(can('BIOCHEMIST', 'billing:create'), false);
  assert.equal(can('BIOCHEMIST', 'billing:issue'), false);
  assert.equal(can('DOCTOR', 'billing:read'), false);
  assert.equal(can('VIEWER', 'billing:read'), false);
  assert.equal(can('DOCTOR', 'users:read'), false);
  assert.equal(can('RECEPTIONIST', 'tests:read'), true);
  assert.equal(can('RECEPTIONIST', 'tests:edit'), false);
  assert.equal(can('LAB_TECHNICIAN', 'tests:read'), true);
  assert.equal(can('LAB_TECHNICIAN', 'tests:edit'), false);
  assert.equal(can('BIOCHEMIST', 'tests:edit'), true);
  assert.equal(can('VIEWER', 'tests:read'), false);
  assert.throws(() => authorize(principal, 'patients:read'), /Access denied/);
  assert.equal(can('RECEPTIONIST', 'orders:create'), true);
  assert.equal(can('RECEPTIONIST', 'orders:place'), true);
  assert.equal(can('RECEPTIONIST', 'orders:cancel'), false);
  assert.equal(can('RECEPTIONIST', 'samples:collect'), false);
  assert.equal(can('LAB_TECHNICIAN', 'patients:read'), true);
  assert.equal(can('LAB_TECHNICIAN', 'samples:collect'), true);
  assert.equal(can('LAB_TECHNICIAN', 'samples:receive'), true);
  assert.equal(can('LAB_TECHNICIAN', 'orders:create'), false);
  assert.equal(can('BIOCHEMIST', 'samples:reject'), true);
  assert.equal(can('BIOCHEMIST', 'orders:cancel'), false);
  assert.equal(can('DOCTOR', 'orders:read'), true);
  assert.equal(can('DOCTOR', 'results:read'), true);
  assert.equal(can('DOCTOR', 'results:enter'), false);
  assert.equal(can('DOCTOR', 'results:validate'), false);
  assert.equal(can('DOCTOR', 'results:verify'), false);
  assert.equal(can('DOCTOR', 'results:amend'), false);
  assert.equal(can('LAB_TECHNICIAN', 'results:enter'), true);
  assert.equal(can('LAB_TECHNICIAN', 'results:validate'), true);
  assert.equal(can('LAB_TECHNICIAN', 'results:verify'), false);
  assert.equal(can('LAB_TECHNICIAN', 'results:amend'), false);
  assert.equal(can('BIOCHEMIST', 'results:verify'), true);
  assert.equal(can('BIOCHEMIST', 'results:amend'), true);
  assert.equal(can('BIOCHEMIST', 'reports:generate'), true);
  assert.equal(can('BIOCHEMIST', 'reports:download'), true);
  assert.equal(can('BIOCHEMIST', 'reports:deliver'), true);
  assert.equal(can('BIOCHEMIST', 'reports:share'), true);
  assert.equal(can('BIOCHEMIST', 'reports:share-revoke'), true);
  assert.equal(can('ORG_ADMIN', 'reports:share'), true);
  assert.equal(can('ORG_ADMIN', 'reports:share-revoke'), true);
  assert.equal(can('DOCTOR', 'reports:read'), true);
  assert.equal(can('DOCTOR', 'reports:download'), true);
  assert.equal(can('DOCTOR', 'reports:generate'), false);
  assert.equal(can('DOCTOR', 'reports:deliver'), false);
  assert.equal(can('DOCTOR', 'reports:share'), false);
  assert.equal(can('DOCTOR', 'reports:share-revoke'), false);
  assert.equal(can('LAB_TECHNICIAN', 'reports:read'), false);
  assert.equal(can('LAB_TECHNICIAN', 'reports:share'), false);
  assert.equal(can('RECEPTIONIST', 'reports:read'), false);
  assert.equal(can('RECEPTIONIST', 'reports:share'), false);
  assert.equal(can('VIEWER', 'reports:share'), false);
  assert.equal(can('RECEPTIONIST', 'results:read'), false);
  assert.equal(can('VIEWER', 'orders:read'), false);
  assert.equal(can('ORG_ADMIN', 'orders:cancel'), true);
});
void test('tenant helpers enforce identity even for platform administrators', () => {
  assert.deepEqual(organizationScope(principal), {
    text: 'organization_id = $1',
    values: ['org-a'],
  });
  assert.throws(() => assertOrganization(principal, 'org-b'), /Access denied/);
  assert.throws(
    () => assertOrganization({ ...principal, role: 'PLATFORM_ADMIN' }, 'org-b'),
    /Access denied/,
  );
  assert.throws(() => organizationScope({ ...principal, organizationId: '' }));
});
void test('credential validation normalizes email and rejects malformed or oversized inputs', () => {
  assert.equal(
    loginSchema.parse({ email: ' TEAM@LAB.COM ', password: 'valid-password' })
      .email,
    'team@lab.com',
  );
  for (const value of [
    { email: 'bad', password: 'test' },
    { email: 'a@b.com', password: '' },
    { email: 'a@b.com', password: 'a'.repeat(257) },
  ])
    assert.equal(loginSchema.safeParse(value).success, false);
});
void test('organization validation checks stable slug, language and timezone', () => {
  const org = {
    name: 'Test Lab',
    slug: 'test-lab',
    type: 'LABORATORY',
    country: 'AL',
    timezone: 'Europe/Tirane',
    defaultLanguage: 'sq',
  };
  assert.equal(organizationSchema.safeParse(org).success, true);
  for (const patch of [
    { slug: '../admin' },
    { timezone: 'not-a-zone' },
    { defaultLanguage: 'xx' },
    { country: 'Albania' },
  ])
    assert.equal(
      organizationSchema.safeParse({ ...org, ...patch }).success,
      false,
    );
});
void test('origin and session validation fail closed', () => {
  assert.equal(validOrigin(null, 'https://app.test'), false);
  assert.equal(validOrigin('https://evil.test', 'https://app.test'), false);
  assert.equal(validOrigin('https://app.test', 'https://app.test'), true);
  for (const token of [undefined, '', 'fake', 'a'.repeat(63), 'G'.repeat(64)])
    assert.equal(validSessionToken(token), false);
  assert.equal(validSessionToken(newSession().token), true);
});
void test('request origin accepts same-origin null Origin only behind a matching HTTPS proxy', () => {
  const expected = 'https://medisoftlabs.online';
  const matchingProxy = {
    origin: 'null',
    secFetchSite: 'same-origin',
    forwardedProto: 'https',
    forwardedHost: 'medisoftlabs.online',
  };
  assert.equal(validRequestOrigin({ origin: expected }, expected), true);
  assert.equal(validRequestOrigin(matchingProxy, expected), true);
  assert.equal(
    validRequestOrigin({ ...matchingProxy, secFetchSite: 'cross-site' }, expected),
    false,
  );
  assert.equal(
    validRequestOrigin(
      { ...matchingProxy, forwardedHost: 'evil.example' },
      expected,
    ),
    false,
  );
  assert.equal(
    validRequestOrigin({ ...matchingProxy, forwardedProto: 'http' }, expected),
    false,
  );
  assert.equal(validRequestOrigin({ origin: null }, expected), false);
  assert.equal(
    validRequestOrigin({ origin: 'https://evil.test' }, expected),
    false,
  );
  assert.equal(
    validRequestOrigin({ ...matchingProxy, secFetchSite: 'same-site' }, expected),
    false,
  );
  assert.equal(
    validRequestOrigin(
      { origin: 'null', secFetchSite: 'same-origin' },
      expected,
    ),
    false,
  );
  const extracted = requestOriginHeaders(
    new Request('https://medisoftlabs.online/api/patients', {
      method: 'POST',
      headers: {
        origin: 'null',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'medisoftlabs.online',
      },
    }),
  );
  assert.deepEqual(extracted, matchingProxy);
  assert.equal(validRequestOrigin(extracted, expected), true);
});
void test('production rejects demo fixtures, localhost origins and stub email without exposing secrets', () => {
  const config = {
    DATABASE_URL:
      'postgresql://medisoft_runtime:n3ver-use-this-in-git@db.internal/medisoft',
    APP_ORIGIN: 'https://app.test',
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'disabled',
  };
  assert.equal(parseEnvironment(config).DASHBOARD_DEMO, 'false');
  assert.throws(() => parseEnvironment({ ...config, DASHBOARD_DEMO: 'true' }));
  assert.throws(() =>
    parseEnvironment({ ...config, APP_ORIGIN: 'http://app.test' }),
  );
  assert.throws(() =>
    parseEnvironment({ ...config, APP_ORIGIN: 'https://localhost' }),
  );
  assert.throws(() => parseEnvironment({ ...config, EMAIL_PROVIDER: 'stub' }));
  assert.throws(
    () => parseEnvironment({ ...config, DATABASE_URL: 'secret' }),
    (e) => e instanceof Error && !e.message.includes('secret'),
  );
});
void test('salted passwords verify and opaque session tokens are distinct', async () => {
  const first = await hashPassword('a-strong-development-password');
  assert.notEqual(first, await hashPassword('a-strong-development-password'));
  assert.equal(
    await verifyPassword('a-strong-development-password', first),
    true,
  );
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(await verifyPassword('anything', 'malformed'), false);
  const session = newSession();
  assert.equal(session.hash, digest(session.token));
  assert.notEqual(session.token, newSession().token);
});
