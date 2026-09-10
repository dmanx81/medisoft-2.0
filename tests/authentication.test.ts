import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { authenticate, revokeSession } from '../lib/auth/transactions';
import { hashPassword, digest } from '../lib/auth/password';
import { sessionQuery } from '../lib/db/session';
import type { Principal } from '../lib/auth/permissions';
void test('login and logout are audited atomically; throttling and credential failures issue no sessions', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../db/migrations/001_foundation.sql', import.meta.url),
        'utf8',
      ),
    );
    const org = (
      await db.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,type,country) VALUES('Test','test','CLINIC','AL') RETURNING id",
      )
    ).rows[0].id;
    const password = 'A valid laboratory password';
    await db.query(
      "INSERT INTO users(organization_id,name,email,password_hash,role) VALUES($1,'Test','admin@example.test',$2,'ORG_ADMIN')",
      [org, await hashPassword(password)],
    );
    assert.equal(
      await authenticate(db, 'missing@example.test', password),
      null,
    );
    assert.equal(
      await authenticate(db, 'admin@example.test', 'incorrect'),
      null,
    );
    const session = await authenticate(db, 'admin@example.test', password);
    assert.ok(session);
    assert.equal(
      (await db.query('SELECT token_hash FROM sessions')).rows.length,
      1,
    );
    const principal = (
      await db.query<Principal>(sessionQuery, [digest(session.token)])
    ).rows[0];
    assert.equal(principal.organizationId, org);
    assert.equal(
      (await db.query<{ action: string }>('SELECT action FROM audit_events'))
        .rows[0].action,
      'AUTH_LOGIN',
    );
    await revokeSession(db, principal);
    assert.equal((await db.query(sessionQuery, [session.hash])).rows.length, 0);
    assert.equal(
      (await db.query("SELECT id FROM audit_events WHERE action='AUTH_LOGOUT'"))
        .rows.length,
      1,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        await authenticate(db, 'admin@example.test', 'incorrect'),
        null,
      );
    assert.equal(
      await authenticate(db, 'admin@example.test', password),
      null,
      'sixth attempt must be throttled',
    );
    await db.query(
      "UPDATE login_limits SET window_start=now()-interval '16 minutes'",
    );
    assert.ok(
      await authenticate(db, 'admin@example.test', password),
      'window expiry should allow login',
    );
    for (let i = 0; i < 4; i++)
      assert.equal(
        await authenticate(db, 'admin@example.test', 'incorrect'),
        null,
      );
    assert.ok(
      await authenticate(db, 'admin@example.test', password),
      'successful login must not count toward the throttle and must reset it',
    );
    // Force audit failure: authentication must not leave an unaudited session.
    const before = (await db.query('SELECT * FROM sessions')).rows.length;
    await db.exec(
      "CREATE FUNCTION reject_audit_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END; $$; CREATE TRIGGER reject_insert BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_insert();",
    );
    await assert.rejects(
      authenticate(db, 'admin@example.test', password),
      /test audit failure/,
    );
    assert.equal(
      (await db.query('SELECT * FROM sessions')).rows.length,
      before,
    );
  } finally {
    await db.close();
  }
});
