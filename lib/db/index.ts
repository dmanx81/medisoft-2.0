import 'server-only';
import { Pool } from 'pg';
import { environment } from '../env';
import { configureEmailProvider } from '../email/configure';
const globalDb = globalThis as typeof globalThis & { medisoftPool?: Pool };
export function database() {
  if (!globalDb.medisoftPool) {
    const config = environment();
    configureEmailProvider(config);
    globalDb.medisoftPool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
  }
  return globalDb.medisoftPool;
}
