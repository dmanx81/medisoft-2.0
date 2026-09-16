import type { QueryRunner } from '@/lib/db/query';
import { ClinicalError } from './types';

export async function clinicalTransaction<T>(
  db: QueryRunner,
  work: () => Promise<T>,
): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    if (error instanceof ClinicalError) throw error;
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === '23505'
    )
      throw new ClinicalError(
        409,
        'CONFLICT',
        'A unique clinical record already exists.',
      );
    throw error;
  }
}
