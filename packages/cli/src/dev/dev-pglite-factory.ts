import type { DataAdapter, DataAdapterFactory } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { withCommandReceipts } from '@keelwerk/data';
import { pgliteAdapter, pgliteSchemaConnection } from '@keelwerk/data/pglite';
import { makePrivateDirectory } from './make-private-directory.ts';

const role = 'kw_app';

/**
 * PGlite as the data adapter 'pglite' of development (S-47): the database lives in the directory
 * the placement's `url` names, so a restart finds what the last run wrote. It creates the
 * application role the units drop to and the receipt table of each namespace the runtime provisions.
 * It reports PGlite's own `processes: 'single'`, so the core opens no concurrent units on it. A
 * process that had to be killed leaves its registration behind and the next start would refuse for
 * it; the probe runs while no app is alive and marks such rows stopped (`stopLeftoverProcesses`).
 */
export function devPgliteFactory(): DataAdapterFactory {
  return {
    id: 'pglite',
    dialect: 'postgres',
    options: { '~standard': { version: 1, vendor: 'keelwerk', validate: (value) => ({ value }) } },
    create: (placement, env) => {
      if (placement.strategy !== 'shared-tables') {
        throw errors.unsupported(
          `PGlite hosts the shared-tables strategy, not ${placement.strategy}`,
        );
      }
      if (placement.url !== undefined) makePrivateDirectory(placement.url);
      const inner = pgliteAdapter(
        { deploymentId: env.deploymentId, tracer: env.tracer },
        {
          placementId: placement.id,
          role,
          ...(placement.url === undefined ? {} : { dataDir: placement.url }),
          ...(env.keyWrapper === undefined ? {} : { keyWrapper: env.keyWrapper }),
        },
      );
      return {
        ...(inner as unknown as DataAdapter),
        placementId: placement.id,
        connect: async () => {
          const capabilities = await inner.connect();
          await inner.asOwner(async (database) => {
            const existing = await database.query('select 1 from pg_roles where rolname = $1', [
              role,
            ]);
            if (existing.rows.length === 0) {
              await database.query(
                `create role "${role}" nosuperuser nobypassrls nocreatedb nocreaterole nologin`,
              );
            }
          });
          return capabilities;
        },
        close: (deadlineMs) => inner.close(deadlineMs),
        health: () => inner.health(),
        identity: () => inner.identity(),
        unit: (namespace, scope, fn, unitOptions) =>
          (inner as unknown as DataAdapter).unit(namespace, scope, fn, unitOptions),
        schema: withCommandReceipts(inner.schema, pgliteSchemaConnection(inner.asOwner), role),
      };
    },
  };
}
