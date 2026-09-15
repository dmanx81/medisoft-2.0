import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { emptyPatient } from '../../features/patients/validation';
import type { Principal } from '../../lib/auth/permissions';
import type { Patient } from '../../features/patients/types';
// Mock only the framework session/connection boundary. Routes, validation,
// authorization, SQL and transactions execute unchanged against PostgreSQL.
const db = new PGlite();
let principal: Principal | null = null;
mock.module('server-only', { defaultExport: {} });
mock.module('../../lib/auth/session.ts', {
  namedExports: { currentUser: async () => principal },
});
mock.module('../../lib/env.ts', {
  namedExports: {
    environment: () => ({ APP_ORIGIN: 'https://clinic.example' }),
  },
});
mock.module('../../lib/db/index.ts', {
  namedExports: {
    database: () => ({
      query: db.query.bind(db),
      connect: async () => ({ query: db.query.bind(db), release: () => {} }),
    }),
  },
});
const createRoute = await import('../../app/api/patients/route');
const detailRoute = await import('../../app/api/patients/[id]/route');
const searchRoute = await import('../../app/api/patients/search/route');
const activityRoute =
  await import('../../app/api/patients/[id]/activity/route');
function request(
  method: string,
  body?: unknown,
  origin = 'https://clinic.example',
) {
  return new Request('https://clinic.example/api/patients', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
void test('authenticated patient API contract enforces permissions, scope, validation and origin', async () => {
  try {
    for (const migration of ['001_foundation.sql', '002_patient_crm.sql'])
      await db.exec(
        await readFile(
          new URL(`../../db/migrations/${migration}`, import.meta.url),
          'utf8',
        ),
      );
    const users: Principal[] = [];
    for (const slug of ['api-a', 'api-b']) {
      const org = (
        await db.query<{ id: string }>(
          "INSERT INTO organizations(name,slug,type,country) VALUES($1,$1,'CLINIC','AL') RETURNING id",
          [slug],
        )
      ).rows[0].id;
      const user = (
        await db.query<{ id: string }>(
          "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Synthetic',$2,'unused','ORG_ADMIN') RETURNING id",
          [org, `${slug}@example.test`],
        )
      ).rows[0].id;
      users.push({
        userId: user,
        organizationId: org,
        role: 'ORG_ADMIN',
        name: 'Synthetic',
        organizationName: slug,
        sessionHash: 'test',
      });
    }
    principal = users[0];
    const data = {
      ...emptyPatient,
      first_name: 'API synthetic',
      last_name: 'Example',
    };
    assert.equal(
      (
        await createRoute.POST(
          request('POST', { data }, 'https://evil.example'),
        )
      ).status,
      403,
    );
    const trustedNull = await createRoute.POST(
      new Request('https://clinic.example/api/patients', {
        method: 'POST',
        headers: {
          origin: 'null',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'clinic.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          data: { ...data, first_name: 'Trusted null origin' },
        }),
      }),
    );
    assert.equal(trustedNull.status, 200);
    assert.equal(
      (
        await createRoute.POST(
          request('POST', {
            data: { ...data, organization_id: users[1].organizationId },
          }),
        )
      ).status,
      400,
    );
    const created = await createRoute.POST(request('POST', { data }));
    assert.equal(created.status, 200);
    assert.ok(created.headers.get('cache-control')?.includes('no-store'));
    const patient = (await created.json()) as Patient;
    const context = { params: Promise.resolve({ id: patient.id }) };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    const updated = await detailRoute.PATCH(
      request('PATCH', { data: { ...data, city: 'Tirana' }, version: 1 }),
      context,
    );
    assert.equal(updated.status, 200);
    assert.equal(
      (await detailRoute.PATCH(request('PATCH', { data, version: 1 }), context))
        .status,
      409,
    );
    assert.equal(
      (await activityRoute.GET(request('GET'), context)).status,
      200,
    );
    principal = users[1];
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 404);
    assert.equal(
      (await detailRoute.PATCH(request('PATCH', { data, version: 2 }), context))
        .status,
      404,
    );
    assert.equal(
      (await activityRoute.GET(request('GET'), context)).status,
      404,
    );
    const search = await searchRoute.POST(
      request('POST', { query: 'API synthetic' }),
    );
    assert.equal(((await search.json()) as { total: number }).total, 0);
    principal = { ...users[0], role: 'DOCTOR' };
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 200);
    assert.equal(
      (await createRoute.POST(request('POST', { data }))).status,
      403,
    );
    assert.equal(
      (await detailRoute.PATCH(request('PATCH', { data, version: 2 }), context))
        .status,
      403,
    );
    assert.equal(
      (await activityRoute.GET(request('GET'), context)).status,
      403,
    );
    principal = null;
    assert.equal((await detailRoute.GET(request('GET'), context)).status, 401);
  } finally {
    await db.close();
  }
});
