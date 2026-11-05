import type { DataAdapter, DataAdapterFactory } from '@keelwerk/core';
import { withCommandReceipts } from '@keelwerk/data';
import { pgliteAdapter, pgliteSchemaConnection } from '@keelwerk/data/pglite';

const role = 'kw_app';

/**
 * PGlite as a data adapter 'pglite' whose database lives in the directory the placement's `url`
 * names, so a second process (or `keelwerk db verify`) finds what the first one wrote and a
 * directory copied back rewinds it.
 */
export function durablePgliteFactory(): DataAdapterFactory {
  return {
    id: 'pglite',
    dialect: 'postgres',
    options: { '~standard': { version: 1, vendor: 'keelwerk', validate: (value) => ({ value }) } },
    create: (placement, env) => {
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
