import { chmodSync, mkdirSync } from 'node:fs';
import type { Clock, DataAdapter, DataAdapterFactory, EntityDescriptor } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { withCommandReceipts } from '../sql/postgres/with-command-receipts.ts';
import { pgliteAdapter } from './pglite-adapter.ts';
import { pgliteSchemaConnection } from './pglite-schema-connection.ts';

const role = 'kw_app';

/** The directory the url names, or `undefined` for an in-memory database. */
function directoryOf(url: string | undefined): string | undefined {
  return url === undefined || url === '' || url.startsWith('memory://') ? undefined : url;
}

/** Creates the directory with mode 0700 (tenant data); one that exists is left as it is. */
function makePrivate(directory: string): void {
  const created = mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (created !== undefined) chmodSync(created, 0o700);
}

/** What `pgliteAdapterFactory` takes. */
export interface PgliteAdapterFactoryOptions {
  /** Finds the descriptor of a relation's target by entity ref. */
  readonly entities?: (ref: string) => EntityDescriptor | undefined;
  /** The time source; default: the runtime's clock (`AdapterEnvironment.clock`), else the system clock. */
  readonly clock?: Clock;
  /** Receives the error of an `afterCommit` callback that threw; default as `pgliteAdapter`. */
  readonly onAfterCommitError?: (error: unknown) => void;
}

/**
 * PGlite as the deployment's data adapter `'pglite'` (sections 4.6 and 14.3.7), for deployment
 * files: a placement or the control store names `adapter: 'pglite'`; its `url` is a directory that
 * survives restarts, or `memory://` (or no url) for an in-memory database.
 */
export function pgliteAdapterFactory(
  options: PgliteAdapterFactoryOptions = {},
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
      const directory = directoryOf(placement.url);
      if (directory !== undefined) makePrivate(directory);
      const clock = options.clock ?? env.clock;
      const inner = pgliteAdapter(
        { deploymentId: env.deploymentId, tracer: env.tracer },
        {
          placementId: placement.id,
          role,
          ...(directory === undefined ? {} : { dataDir: directory }),
          ...(clock === undefined ? {} : { clock }),
          ...(options.entities === undefined ? {} : { entities: options.entities }),
          ...(env.keyWrapper === undefined ? {} : { keyWrapper: env.keyWrapper }),
          ...(options.onAfterCommitError === undefined
            ? {}
            : { onAfterCommitError: options.onAfterCommitError }),
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
