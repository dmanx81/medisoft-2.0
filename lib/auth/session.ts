import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { database } from '../db';
import { sessionQuery, type SessionRow } from '../db/session';
import { digest } from './password';
import { validSessionToken } from '../validation';
import { authorize, type Permission } from './permissions';
export const sessionCookie = 'medisoft_session';
export async function currentUser() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!validSessionToken(token)) return null;
  const result = await database().query<SessionRow>(sessionQuery, [
    digest(token),
  ]);
  return result.rows[0] ?? null;
}
export async function requireUser(permission?: Permission) {
  const principal = await currentUser();
  if (!principal) redirect('/login');
  if (permission) authorize(principal, permission);
  return principal;
}
