import type { Role, Principal } from '../auth/permissions';
export const sessionQuery = `SELECT u.id AS "userId", u.organization_id AS "organizationId", u.role, u.name,
 o.name AS "organizationName", s.token_hash AS "sessionHash"
 FROM sessions s JOIN users u ON u.id=s.user_id AND u.organization_id=s.organization_id
 JOIN organizations o ON o.id=u.organization_id
 WHERE s.token_hash=$1 AND s.expires_at > now() AND u.status='ACTIVE'`;
export type SessionRow = Principal & { role: Role };
