import type { DataAdapter, DataAdapterFactory, EntityDescriptor } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { commandReceiptDdl } from '@keelwerk/data/conformance';
import { pgliteAdapter } from '@keelwerk/data/pglite';

const role = 'kw_app';

/** What `transportPglite` takes. */
export interface PgliteTransportOptions {
  /** Finds the descriptor of a relation's target by entity ref. */
  readonly entities?: (ref: string) => EntityDescriptor | undefined;
}

/**
 * PGlite as a deployment's data adapter 'pglite' (one in-memory database per placement): creates
 * the application role the units drop to, hands the adapter the runtime's key wrapper, and creates
 * the receipt table of each namespace the runtime provisions (the core's provisioning of S-22).
 */
export function transportPglite(options: PgliteTransportOptions = {}): DataAdapterFactory {
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
          ...(env.clock === undefined ? {} : { clock: env.clock }),
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
        schema: {
          ...inner.schema,
          provision: async (namespace, snapshots, provisionOptions) => {
            await inner.schema.provision(namespace, snapshots, provisionOptions);
            await inner.asOwner(async (database) => {
              const table = `"${namespace.root}".core__command_receipt`;
              const present = await database.query('select to_regclass($1) as found', [table]);
              if ((present.rows[0] as { found: string | null } | undefined)?.found != null) return;
              for (const statement of commandReceiptDdl(namespace.root))
                await database.query(statement);
              await database.query(`grant select, insert, update, delete on ${table} to "${role}"`);
            });
          },
        },
      };
      return adapter;
    },
  };
}
