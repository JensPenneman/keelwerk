import { setTimeout as delay } from 'node:timers/promises';
import type { ClientConnection } from './client-connection.ts';
import { openClientConnections } from './open-client-connections.ts';
import type { PostgresCluster } from './postgres-cluster.ts';

const pollMs = 100;

function describeConnection(connection: ClientConnection): string {
  return `pid ${connection.pid} "${connection.applicationName}" on ${connection.database} (${connection.state})`;
}

/**
 * Waits until no client backend outside `except` is open; rejects with an Error naming each one
 * that is still open after `timeoutMs` (default 10000; checked every 100 ms). A teardown wait on
 * the server's state, not an assertion against wall time: an adapter's pool may still be ending
 * when its runtime reports that it stopped.
 */
export async function assertConnectionsClosed(
  cluster: PostgresCluster,
  options: { readonly except?: readonly number[]; readonly timeoutMs?: number } = {},
): Promise<void> {
  const except = new Set(options.except ?? []);
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  while (true) {
    const open = (await openClientConnections(cluster)).filter(
      (connection) => !except.has(connection.pid),
    );
    if (open.length === 0) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `The test file left ${open.length} PostgreSQL connection(s) open: ${open.map(describeConnection).join(', ')}. ` +
          'Stop every runtime (await runtime.stop()) and end every pool and client it opened (await pool.end(), await client.end()) in afterAll, before the container stops.',
      );
    }
    await delay(pollMs);
  }
}
