import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sessionQuery } from '../lib/db/session';
import { organizationScope } from '../lib/db/tenant';
import type { Principal } from '../lib/auth/permissions';
void test('migration, tenant constraints, live sessions and audit immutability', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../db/migrations/001_foundation.sql', import.meta.url),
        'utf8',
      ),
    );
    const a = '00000000-0000-4000-8000-000000000001',
      b = '00000000-0000-4000-8000-000000000002',
      u = '00000000-0000-4000-8000-000000000003';
    await db.query(
      "INSERT INTO organizations(id,name,slug,type,country) VALUES($1,'A','a','LABORATORY','AL'),($2,'B','b','CLINIC','AL')",
      [a, b],
    );
    await db.query(
      "INSERT INTO users(id,organization_id,name,email,password_hash,role) VALUES($1,$2,'Test','test@example.test','unused','ORG_ADMIN')",
      [u, a],
    );
    const principal: Principal = {
      userId: u,
      organizationId: b,
      role: 'ORG_ADMIN',
      name: 'B',
      organizationName: 'B',
      sessionHash: '',
    };
    const scope = organizationScope(principal);
    assert.equal(
      (await db.query(`SELECT id FROM users WHERE ${scope.text}`, scope.values))
        .rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        ['x'.repeat(64), b, u],
      ),
      /foreign key/,
    );
    assert.equal((await db.query(sessionQuery, ['forged'])).rows.length, 0);
    const token = 'a'.repeat(64);
    await db.query(
      "INSERT INTO sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [token, a, u],
    );
    assert.equal(
      (await db.query<Principal>(sessionQuery, [token])).rows[0].organizationId,
      a,
    );
    await db.query("UPDATE users SET status='DISABLED' WHERE id=$1", [u]);
    assert.equal((await db.query(sessionQuery, [token])).rows.length, 0);
    await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [u]);
    await db.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
    assert.equal((await db.query(sessionQuery, [token])).rows.length, 0);
    await db.query(
      "INSERT INTO audit_events(organization_id,user_id,action,entity_type) VALUES($1,$2,'TEST','USER')",
      [a, u],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO audit_events(organization_id,user_id,action,entity_type) VALUES($1,$2,'TEST','USER')",
        [b, u],
      ),
      /foreign key/,
    );
    for (const sql of [
      "UPDATE audit_events SET action='CHANGED'",
      'DELETE FROM audit_events',
      'TRUNCATE audit_events',
    ])
      await assert.rejects(db.exec(sql), /append-only/);
    assert.equal((await db.query('SELECT * FROM audit_events')).rows.length, 1);
  } finally {
    await db.close();
  }
});
