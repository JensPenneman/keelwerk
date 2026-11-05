import type { DataAdapter, DataAdapterFactory } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { withCommandReceipts } from '@keelwerk/data';
import { pgliteAdapter, pgliteSchemaConnection } from '@keelwerk/data/pglite';

const role = 'kw_app';

/** PGlite as the data adapter 'pglite': one in-memory database per placement, the units drop to the application role. */
export function pgliteFactory(): DataAdapterFactory {
  return {
    id: 'pglite',
    dialect: 'postgres',
    options: {
      '~standard': { version: 1, vendor: 'keelwerk', validate: (value) => ({ value }) },
    },
    create: (placement, env) => {
      if (placement.strategy !== 'shared-tables') {
        throw errors.unsupported(
          `PGlite hosts the shared-tables strategy, not ${placement.strategy}`,
        );
      }
      const inner = pgliteAdapter(
        { deploymentId: env.deploymentId, tracer: env.tracer },
        {
          placementId: placement.id,
          role,
          ...(env.keyWrapper === undefined ? {} : { keyWrapper: env.keyWrapper }),
        },
      );
      const adapter: DataAdapter = {
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
      return adapter;
    },
  };
}
