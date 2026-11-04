import { mapSqlError } from './map-sql-error.ts';

/** Runs `work` and throws what the contract calls a failed statement's error (`mapSqlError`). */
export async function sqlGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw mapSqlError(error);
  }
}
