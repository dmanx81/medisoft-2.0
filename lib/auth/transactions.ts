import type { QueryRunner } from '../db/query';
import { digest, dummyPassword, newSession, verifyPassword } from './password';
import type { Principal } from './permissions';
export async function appendAuthEvent(
  db: QueryRunner,
  principal: Pick<Principal, 'userId' | 'organizationId' | 'sessionHash'>,
  action: 'AUTH_LOGIN' | 'AUTH_LOGOUT',
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,session_hash)
 VALUES($1,$2,$3,'USER',($2::uuid)::text,$4)`,
    [principal.organizationId, principal.userId, action, principal.sessionHash],
  );
}
// Caller supplies a dedicated connection; no transaction may cross connections.
export async function authenticate(
  db: QueryRunner,
  email: string,
  password: string,
) {
  const accountHash = digest(email);
  const limit = await db.query<{ attempts: number }>(
    `INSERT INTO login_limits(account_hash,attempts) VALUES($1,0)
 ON CONFLICT(account_hash) DO UPDATE SET
 attempts=CASE WHEN login_limits.window_start < now()-interval '15 minutes' THEN 0 ELSE login_limits.attempts END,
 window_start=CASE WHEN login_limits.window_start < now()-interval '15 minutes' THEN now() ELSE login_limits.window_start END
 RETURNING attempts`,
    [accountHash],
  );
  if (limit.rows[0].attempts >= 5) return null;
  const result = await db.query<{
    id: string;
    organization_id: string;
    password_hash: string;
    status: string;
  }>(
    'SELECT id,organization_id,password_hash,status FROM users WHERE email=$1',
    [email],
  );
  const user = result.rows[0];
  const correct = await verifyPassword(
    password,
    user?.password_hash ?? dummyPassword,
  );
  if (!user || !correct || user.status !== 'ACTIVE') {
    await db.query(
      `UPDATE login_limits SET
 attempts=CASE WHEN window_start < now()-interval '15 minutes' THEN 1 ELSE attempts+1 END,
 window_start=CASE WHEN window_start < now()-interval '15 minutes' THEN now() ELSE window_start END
 WHERE account_hash=$1`,
      [accountHash],
    );
    return null;
  }
  const session = newSession();
  await db.query('BEGIN');
  try {
    // Lock and recheck credential + membership to close concurrent account-change races.
    const active = await db.query(
      "SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND password_hash=$3 AND status='ACTIVE' FOR UPDATE",
      [user.id, user.organization_id, user.password_hash],
    );
    if (!active.rows.length) {
      await db.query('ROLLBACK');
      return null;
    }
    await db.query(
      'UPDATE login_limits SET attempts=0, window_start=now() WHERE account_hash=$1',
      [accountHash],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
      [session.hash, user.organization_id, user.id],
    );
    await db.query('UPDATE users SET last_login_at=now() WHERE id=$1', [
      user.id,
    ]);
    await appendAuthEvent(
      db,
      {
        userId: user.id,
        organizationId: user.organization_id,
        sessionHash: session.hash,
      },
      'AUTH_LOGIN',
    );
    await db.query('COMMIT');
    return session;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
export async function revokeSession(db: QueryRunner, principal: Principal) {
  await db.query('BEGIN');
  try {
    await db.query(
      'DELETE FROM sessions WHERE token_hash=$1 AND organization_id=$2',
      [principal.sessionHash, principal.organizationId],
    );
    await appendAuthEvent(db, principal, 'AUTH_LOGOUT');
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
