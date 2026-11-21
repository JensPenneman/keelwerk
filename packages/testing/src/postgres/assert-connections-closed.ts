import type { ClientConnection } from './client-connection.ts';
import { openClientConnections } from './open-client-connections.ts';
import type { PostgresCluster } from './postgres-cluster.ts';
import { waitForEmptyListing } from './wait-for-empty-listing.ts';

const pollMs = 100;

function describeConnection(connection: ClientConnection): string {
  return `pid ${connection.pid} "${connection.applicationName}" on ${connection.database} (${connection.state})`;
}

/**
 * Waits until no client backend outside `except` is open; rejects with an Error naming each one
 * that a listing started after `timeoutMs` (default 2000; listed every 100 ms) still shows. A
 * teardown wait on the server's state, not an assertion against wall time. After a correct close
 * the first listing already comes back clean (at most 55 ms over 80 PostgreSQL files on a Mac, the
 * time of the listing itself); 2000 ms is far above that and far below pg-pool's 10 000 ms idle
 * timeout, which would otherwise close a pool that was never ended before the last listing. The
 * bound is a minimum grace: a failure rests only on a listing that started after it, so a
 * listing slower than the bound cannot fail a clean file (see `waitForEmptyListing`).
 */
export async function assertConnectionsClosed(
  cluster: PostgresCluster,
  options: { readonly except?: readonly number[]; readonly timeoutMs?: number } = {},
): Promise<void> {
  const except = new Set(options.except ?? []);
  const open = await waitForEmptyListing(
    async () =>
      (await openClientConnections(cluster)).filter((connection) => !except.has(connection.pid)),
    { timeoutMs: options.timeoutMs ?? 2000, pollMs },
  );
  if (open.length === 0) return;
  throw new Error(
    `The test file left ${open.length} PostgreSQL connection(s) open: ${open.map(describeConnection).join(', ')}. ` +
      'Stop every runtime (await runtime.stop()) and end every pool and client it opened (await pool.end(), await client.end()) in afterAll, before the container stops.',
  );
}
