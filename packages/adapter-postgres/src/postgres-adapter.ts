import type { DataAdapterFactory, SchemaOperations } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import {
  maskCapabilities,
  pgSchemaConnection,
  postgresSchemaOperations,
  withCommandReceipts,
} from '@keelwerk/data';
import pg from 'pg';
import { connectionTimeout } from './connection-timeout.ts';
import { createPostgresInstance } from './create-postgres-instance.ts';
import { maskUnit } from './mask-unit.ts';
import { placementRole } from './placement-role.ts';
import type { PostgresAdapterOptions } from './postgres-adapter-options.ts';
import { createPostgresChangeFeed } from './postgres-change-feed.ts';
import { postgresOptionsSchema } from './postgres-options-schema.ts';
import { switchedOffAccelerations } from './switched-off-accelerations.ts';
import { unitScopeId } from './unit-scope-id.ts';

const needsOwner =
  'schema changes run as the database owner, and the placement names only the application role';

/** Without an owner url the two operations that create tables refuse; with one the schema is used as is. */
function ownerOnly(options: PostgresAdapterOptions, schema: SchemaOperations): SchemaOperations {
  if (options.ownerUrl !== undefined && options.ownerUrl !== '') return schema;
  return {
    ...schema,
    apply: async () => {
      throw errors.unsupported(needsOwner);
    },
    provision: async () => {
      throw errors.unsupported(needsOwner);
    },
  };
}

/**
 * The PostgreSQL adapter (14.3.7): the `pg` driver, a pool per placement, units that set their
 * scope and run as the pool's role, the cluster identity and error mapping. The SQL lives in
 * `@keelwerk/data` (S-10), the schema operations included: they read and lock on a client of their
 * own, as the owner the `ownerUrl` option names (decision 134). The placement's url is the
 * application role, which must not own tables or switch row-level security off, so without an
 * owner url `apply` and `provision` refuse.
 * The change feed is `notify`: units that appended events report their scope after commit, the
 * notifier sends the wake-ups, and the heads are polled every second as the recovery (14.3.7).
 * `accelerations: { rowLocks: false, notify: false }` reports `rowLocks: false` and
 * `changeFeed: 'poll'`, sends no `NOTIFY` and opens no `LISTEN`, so the kernel's fallback paths run.
 * Listed in a deployment as the adapter `postgres`.
 */
export function postgresAdapter(options: PostgresAdapterOptions = {}): DataAdapterFactory {
  return {
    id: 'postgres',
    dialect: 'postgres',
    options: postgresOptionsSchema,
    create: (placement, env) => {
      const instance = createPostgresInstance(options, placement, env);
      const clock = options.clock ?? env.clock;
      const off = switchedOffAccelerations(options);
      const feed = createPostgresChangeFeed({
        url: placement.url ?? '',
        applicationName: options.applicationName ?? 'keelwerk',
        log: env.log,
        adapter: instance,
        notify: !off.includes('changeFeed'),
        connectionTimeoutMs: connectionTimeout(placement.options),
      });
      const hasOwner = options.ownerUrl !== undefined && options.ownerUrl !== '';
      // The role is derived only where the schema operations run as an owner and drop to it.
      const role = hasOwner ? placementRole(placement.id, placement.url) : undefined;
      if (hasOwner && role === undefined) {
        throw errors.validation(
          `the placement ${placement.id} names no user in its url, so the application role cannot be derived`,
        );
      }
      const connection = pgSchemaConnection(async (url) => {
        const connectionString = url ?? options.ownerUrl ?? placement.url;
        if (connectionString === undefined || connectionString === '') {
          throw errors.validation(`the placement ${placement.id} needs a url`);
        }
        const client = new pg.Client({
          connectionString,
          // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
          application_name: `${options.applicationName ?? 'keelwerk'}-migrate`,
        });
        await client.connect();
        return client;
      });
      return {
        ...instance,
        connect: async () => maskCapabilities(await instance.connect(), off),
        close: async (deadlineMs) => {
          await Promise.all([feed.close(deadlineMs), instance.close(deadlineMs)]);
        },
        unit: async (namespace, scope, fn, unitOptions) =>
          instance.unit(
            namespace,
            scope,
            async (u) => {
              const scopeId = unitScopeId(scope, env.deploymentId);
              if (!u.readOnly && scopeId !== undefined) {
                u.afterCommit(() => {
                  if (u.events.committed().length > 0) feed.committed(namespace.id, scopeId);
                });
              }
              return fn(maskUnit(u, off));
            },
            unitOptions,
          ),
        feed: feed.source,
        schema: ownerOnly(
          options,
          withCommandReceipts(
            postgresSchemaOperations(connection, {
              ...(role === undefined ? {} : { role }),
              ...(clock === undefined ? {} : { clock }),
            }),
            connection,
            role,
          ),
        ),
      };
    },
  };
}
