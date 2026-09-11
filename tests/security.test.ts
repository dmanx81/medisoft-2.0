import test from 'node:test';
import assert from 'node:assert/strict';
import { can, authorize, roles, type Principal } from '../lib/auth/permissions';
import { organizationScope, assertOrganization } from '../lib/db/tenant';
import {
  loginSchema,
  organizationSchema,
  validOrigin,
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
void test('production rejects demo fixtures and non-HTTPS origins without exposing secrets', () => {
  const config = {
    DATABASE_URL: 'postgresql://user:secret@localhost/db',
    APP_ORIGIN: 'https://app.test',
    NODE_ENV: 'production',
  };
  assert.equal(parseEnvironment(config).DASHBOARD_DEMO, 'false');
  assert.throws(() => parseEnvironment({ ...config, DASHBOARD_DEMO: 'true' }));
  assert.throws(() =>
    parseEnvironment({ ...config, APP_ORIGIN: 'http://app.test' }),
  );
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
