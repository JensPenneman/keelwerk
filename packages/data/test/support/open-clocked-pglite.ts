import { type PgliteAdapter, pgliteAdapter } from '../../src/pglite/index.ts';
import { deployment } from './deployment.ts';
import { fixedInstant } from './fixed-instant.ts';

/** A connected in-memory PGlite adapter on a fixed clock whose application role exists and whose roots do not. */
export async function openClockedPglite(): Promise<PgliteAdapter> {
  const adapter = pgliteAdapter(
    { deploymentId: deployment },
    { clock: { now: () => fixedInstant } },
  );
  await adapter.connect();
  await adapter.asOwner(async (database) =>
    database.exec(`create role "kw_app" nosuperuser nobypassrls nocreatedb nocreaterole nologin`),
  );
  return adapter;
}
