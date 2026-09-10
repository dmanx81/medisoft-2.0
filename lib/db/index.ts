import 'server-only';
import { Pool } from 'pg';
import { environment } from '../env';
const globalDb = globalThis as typeof globalThis & { medisoftPool?: Pool };
export function database() {
  globalDb.medisoftPool ??= new Pool({
    connectionString: environment().DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  return globalDb.medisoftPool;
}
