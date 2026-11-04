import type { DataAdapterFactory } from '@keelwerk/core';
import { createPostgresInstance } from './create-postgres-instance.ts';
import type { PostgresAdapterOptions } from './postgres-adapter-options.ts';
import { postgresOptionsSchema } from './postgres-options-schema.ts';

/**
 * The PostgreSQL adapter (14.3.7): the `pg` driver, a pool per placement, units that set their
 * scope and run as the pool's role, the cluster identity and error mapping. The SQL lives in
 * `@keelwerk/data` (S-10). Listed in a deployment as the adapter `postgres`.
 */
export function postgresAdapter(options: PostgresAdapterOptions = {}): DataAdapterFactory {
  return {
    id: 'postgres',
    dialect: 'postgres',
    options: postgresOptionsSchema,
    create: (placement, env) => createPostgresInstance(options, placement, env),
  };
}
