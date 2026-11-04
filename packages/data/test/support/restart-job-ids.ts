import type { PgliteAdapter } from '../../src/pglite/index.ts';

/** Starts the job and lane ids over at 1, which a truncate leaves running, so a test can name them. */
export async function restartJobIds(adapter: PgliteAdapter): Promise<void> {
  await adapter.asOwner(async (database) => {
    await database.query('alter table app.kw_jobs alter column id restart with 1');
    await database.query('alter table app.kw_job_lanes alter column id restart with 1');
  });
}
