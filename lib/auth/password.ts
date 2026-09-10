import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(':');
  if (
    algorithm !== 'scrypt' ||
    !/^[a-f0-9]{32}$/.test(salt ?? '') ||
    !/^[a-f0-9]{128}$/.test(hash ?? '')
  )
    return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function newSession() {
  const token = randomBytes(32).toString('hex');
  return { token, hash: digest(token) };
}
// Used for unknown users too, so password work does not expose account existence.
export const dummyPassword = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
