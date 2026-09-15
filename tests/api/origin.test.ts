import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Principal } from '../../lib/auth/permissions';

const expected = 'https://medisoftlabs.online';
const principal: Principal = {
  userId: 'user-a',
  organizationId: 'org-a',
  role: 'ORG_ADMIN',
  name: 'Test',
  organizationName: 'Test',
  sessionHash: 'hash',
};
let signedIn: Principal | null = principal;

mock.module('server-only', { defaultExport: {} });
mock.module('../../lib/auth/session.ts', {
  namedExports: {
    currentUser: async () => signedIn,
    sessionCookie: 'medisoft_session',
  },
});
mock.module('../../lib/env.ts', {
  namedExports: {
    environment: () => ({ APP_ORIGIN: expected, NODE_ENV: 'production' }),
  },
});
mock.module('../../lib/db/index.ts', {
  namedExports: {
    database: () => ({
      connect: async () => {
        throw new Error('origin tests must not open the database');
      },
    }),
  },
});

const { patientApi } = await import('../../features/patients/http');
const { catalogueApi } = await import('../../features/catalogue/http');
const { orderApi } = await import('../../features/orders/http');
const { resultApi } = await import('../../features/results/http');
const { reportApi, publicShareApi } = await import(
  '../../features/reports/http'
);
const { billingApi } = await import('../../features/billing/http');
const { POST: logout } = await import('../../app/api/auth/logout/route');

const trustedNull = {
  origin: 'null',
  'sec-fetch-site': 'same-origin',
  'x-forwarded-proto': 'https',
  'x-forwarded-host': 'medisoftlabs.online',
};

const originCases = [
  { name: 'exact production origin', headers: { origin: expected }, accept: true },
  { name: 'trusted same-origin Origin:null', headers: trustedNull, accept: true },
  {
    name: 'Origin:null + cross-site',
    headers: { ...trustedNull, 'sec-fetch-site': 'cross-site' },
    accept: false,
  },
  {
    name: 'Origin:null + same-site',
    headers: { ...trustedNull, 'sec-fetch-site': 'same-site' },
    accept: false,
  },
  {
    name: 'Origin:null + wrong forwarded host',
    headers: { ...trustedNull, 'x-forwarded-host': 'evil.example' },
    accept: false,
  },
  {
    name: 'Origin:null + missing forwarded headers',
    headers: { origin: 'null', 'sec-fetch-site': 'same-origin' },
    accept: false,
  },
  {
    name: 'foreign non-null origin',
    headers: { origin: 'https://evil.test' },
    accept: false,
  },
  { name: 'missing Origin', headers: {}, accept: false },
] as const;

function mutation(headers: Record<string, string>) {
  return new Request(`${expected}/api/patients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  });
}

async function assertWrapper(
  label: string,
  run: (request: Request) => Promise<Response>,
  acceptedStatus = 200,
) {
  for (const originCase of originCases) {
    const response = await run(mutation(originCase.headers));
    assert.equal(
      response.status,
      originCase.accept ? acceptedStatus : 403,
      `${label} ${originCase.name}`,
    );
    if (!originCase.accept && acceptedStatus === 200) {
      const body = (await response.json()) as { code?: string };
      assert.equal(body.code, 'FORBIDDEN', `${label} ${originCase.name} code`);
    }
  }
}

void test('mutation wrappers and logout accept trusted Origin:null and reject CSRF origins', async () => {
  await assertWrapper('patients', (request) =>
    patientApi(request, 'patients:create', async () => ({ ok: true })),
  );
  await assertWrapper('catalogue', (request) =>
    catalogueApi(request, 'tests:edit', async () => ({ ok: true })),
  );
  await assertWrapper('orders', (request) =>
    orderApi(request, 'orders:create', async () => ({ ok: true })),
  );
  await assertWrapper('results', (request) =>
    resultApi(request, 'results:enter', async () => ({ ok: true })),
  );
  await assertWrapper('reports', (request) =>
    reportApi(request, 'reports:generate', async () => ({ ok: true })),
  );
  await assertWrapper('billing', (request) =>
    billingApi(request, 'billing:create', async () => ({ ok: true })),
  );
  await assertWrapper(
    'public share verify',
    (request) => publicShareApi(request, async () => ({ ok: true }), { checkOrigin: true }),
  );
  signedIn = null;
  await assertWrapper('logout', (request) => logout(request), 303);
});
