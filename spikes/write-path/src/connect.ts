import type { Client, ClientConfig } from 'pg';
import pg from 'pg';

/**
 * Opens one dedicated connection. The application name tags the backend in pg_stat_activity, which
 * the lock-wait sampler uses to tell which scope a waiting or blocking writer belongs to.
 */
export async function connect(config: ClientConfig, applicationName: string): Promise<Client> {
  const client = new pg.Client(config);
  // A connection dropped by the server (container stop) surfaces on the next query instead.
  client.on('error', () => undefined);
  await client.connect();
  await client.query(`select set_config('application_name', $1, false)`, [applicationName]);
  return client;
}
