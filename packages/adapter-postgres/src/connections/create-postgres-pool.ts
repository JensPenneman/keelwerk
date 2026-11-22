import type { Logger } from '@keelwerk/core';
import pg from 'pg';
import type { PostgresPlacementOptions } from '../postgres-placement-options.ts';

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
 * The one place a pool is created: the placement's connection pool, in which every client gets its
 * own handler of errors. Every session ends a transaction left idle (section 14.3.6) and is tagged
 * in `pg_stat_activity`. An error on a connection, idle or in use (the server restarted or ended
 * it), is logged once as a warning with its message only; the pool drops that connection and the
 * next unit opens another. A connection lost at a unit's first statement makes that unit begin
 * again on another connection (`runPostgresSession`); a connection lost while the unit's work runs
 * fails it with `core.unavailable`.
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
  // pg-pool listens for errors of idle clients only: it removes that listener when it hands a client
  // out. Every client gets its own listener, so a connection that ends while a unit holds it is not
  // an uncaught exception. The error object is never logged: the pool attaches the client, whose
  // options hold the password.
  const reported = new WeakSet<pg.PoolClient>();
  const report = (error: Error, client: pg.PoolClient | undefined): void => {
    if (client !== undefined) {
      if (reported.has(client)) return;
      reported.add(client);
    }
    settings.log.warn(
      'postgres pool: a connection failed; the pool drops it and the next unit opens another',
      { message: error.message },
    );
  };
  pool.on('connect', (client) => {
    client.on('error', (error) => report(error, client));
  });
  pool.on('error', (error, client) => report(error, client));
  return pool;
}
