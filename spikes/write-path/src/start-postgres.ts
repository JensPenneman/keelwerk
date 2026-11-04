import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { ClientConfig } from 'pg';
import { connect } from './connect.ts';
import { createSchema } from './create-schema.ts';
import { postgresImage } from './postgres-image.ts';
import type { RunningPostgres } from './running-postgres.ts';

/**
 * Starts one PostgreSQL 18 container with the image's default durability settings (fsync and
 * synchronous_commit on) and creates the schema. Clients reach it over TCP through the container
 * runtime's port forwarding, so every statement pays a network round trip.
 */
export async function startPostgres(): Promise<RunningPostgres> {
  const container = await new PostgreSqlContainer(postgresImage)
    .withCommand([
      'postgres',
      '-c',
      'max_connections=200',
      '-c',
      'shared_preload_libraries=pg_stat_statements',
    ])
    .start();
  const admin: ClientConfig = {
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  };
  const client = await connect(admin, 'setup');
  try {
    await createSchema(client);
    const version = await client.query<{ version: string }>(`select version()`);
    return {
      admin,
      app: { ...admin, user: 'kw_app', password: 'kw_app' },
      version: version.rows[0]?.version ?? 'unknown',
      stop: async () => {
        await container.stop();
      },
    };
  } finally {
    await client.end();
  }
}
