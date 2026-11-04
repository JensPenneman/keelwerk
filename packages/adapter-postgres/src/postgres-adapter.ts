import type { DataAdapterFactory, SchemaOperations } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { pgSchemaConnection, postgresSchemaOperations } from '@keelwerk/data';
import pg from 'pg';
import { createPostgresInstance } from './create-postgres-instance.ts';
import type { PostgresAdapterOptions } from './postgres-adapter-options.ts';
import { postgresOptionsSchema } from './postgres-options-schema.ts';

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
 * Listed in a deployment as the adapter `postgres`.
 */
export function postgresAdapter(options: PostgresAdapterOptions = {}): DataAdapterFactory {
  return {
    id: 'postgres',
    dialect: 'postgres',
    options: postgresOptionsSchema,
    create: (placement, env) => ({
      ...createPostgresInstance(options, placement, env),
      schema: ownerOnly(
        options,
        postgresSchemaOperations(
          pgSchemaConnection(async (url) => {
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
          }),
        ),
      ),
    }),
  };
}
