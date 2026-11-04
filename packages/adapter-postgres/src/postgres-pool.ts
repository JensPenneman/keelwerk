import type { Logger } from '@keelwerk/core';
import pg from 'pg';
import type { PostgresPlacementOptions } from './postgres-placement-options.ts';

/** What `createPostgresPool` takes. */
export interface PostgresPoolSettings {
  readonly url: string;
  readonly applicationName: string;
  readonly max?: number;
  readonly idleTimeoutMs?: number;
  readonly options: PostgresPlacementOptions;
  readonly log: Logger;
}

/**
 * The placement's connection pool. Every session ends a transaction left idle (section 14.3.6) and
 * is tagged in `pg_stat_activity`. An error on an idle connection (the server went away) is logged;
 * the pool drops that connection and the next unit opens another.
 */
export function createPostgresPool(settings: PostgresPoolSettings): pg.Pool {
  const pool = new pg.Pool({
    connectionString: settings.url,
    // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
    application_name: settings.applicationName,
    // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
    idle_in_transaction_session_timeout: settings.options.idleInTransactionTimeoutMs,
    connectionTimeoutMillis: settings.options.connectionTimeoutMs,
    ...(settings.max === undefined ? {} : { max: settings.max }),
    ...(settings.idleTimeoutMs === undefined ? {} : { idleTimeoutMillis: settings.idleTimeoutMs }),
  });
  pool.on('error', (error) => {
    settings.log.warn('postgres pool: an idle connection failed', { message: error.message });
  });
  return pool;
}
