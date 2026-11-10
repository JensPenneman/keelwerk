import type { Clock, DataAdapter, DataAdapterFactory, EntityDescriptor } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { withCommandReceipts } from '@keelwerk/data';
import { pgliteAdapter, pgliteSchemaConnection } from '@keelwerk/data/pglite';

const role = 'kw_app';

/** What `pgliteFactory` takes. */
export interface PgliteFactoryOptions {
  /** Finds the descriptor of a relation's target by entity ref. */
  readonly entities?: (ref: string) => EntityDescriptor | undefined;
  /** The time source of bucket refills and key timestamps; default: the runtime's clock, else the system clock. */
  readonly clock?: Clock;
  /** Receives every adapter the factory creates, by placement id. */
  readonly onCreate?: (placementId: string, adapter: DataAdapter) => void;
}

/**
 * PGlite as a deployment's data adapter 'pglite' (one in-memory database per placement): creates
 * the application role the units drop to, hands the adapter the runtime's key wrapper, and creates
 * the receipt table of each namespace the runtime provisions (the core's provisioning of S-22).
 */
export function pgliteFactory(options: PgliteFactoryOptions = {}): DataAdapterFactory {
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
      const clock = options.clock ?? env.clock;
      const inner = pgliteAdapter(
        { deploymentId: env.deploymentId, tracer: env.tracer },
        {
          placementId: placement.id,
          role,
          ...(clock === undefined ? {} : { clock }),
          ...(options.entities === undefined ? {} : { entities: options.entities }),
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
      options.onCreate?.(placement.id, adapter);
      return adapter;
    },
  };
}
