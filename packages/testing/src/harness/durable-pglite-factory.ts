import type { DataAdapter, DataAdapterFactory, PlacementConfig } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { withCommandReceipts } from '@keelwerk/data';
import { pgliteAdapter, pgliteSchemaConnection } from '@keelwerk/data/pglite';
import type { IdentityOf } from './identity-of.ts';

const role = 'kw_app';

/**
 * PGlite as a data adapter 'pglite' whose database lives in the directory `dataDirOf` names for a
 * placement (in memory when it answers nothing), so a second runtime, process or command finds what
 * the first one wrote, and a directory copied back rewinds it. `identity` lets a test answer another
 * system id or timeline, as a point-in-time recovery does.
 */
export function durablePgliteFactory(
  options: {
    readonly dataDirOf?: (placement: PlacementConfig) => string | undefined;
    readonly identity?: IdentityOf;
  } = {},
): DataAdapterFactory {
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
      const dataDir = options.dataDirOf?.(placement);
      const inner = pgliteAdapter(
        { deploymentId: env.deploymentId, tracer: env.tracer },
        {
          placementId: placement.id,
          role,
          ...(dataDir === undefined ? {} : { dataDir }),
          ...(env.clock === undefined ? {} : { clock: env.clock }),
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
        identity: async () => {
          const identity = await inner.identity();
          return options.identity?.(identity) ?? identity;
        },
        unit: (namespace, scope, fn, unitOptions) =>
          (inner as unknown as DataAdapter).unit(namespace, scope, fn, unitOptions),
        schema: withCommandReceipts(inner.schema, pgliteSchemaConnection(inner.asOwner), role),
      };
      return adapter;
    },
  };
}
