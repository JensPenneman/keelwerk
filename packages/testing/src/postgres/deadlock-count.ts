import { execInContainer } from './exec-in-container.ts';
import type { PostgresCluster } from './postgres-cluster.ts';

/**
 * How many deadlocks PostgreSQL has ended in the cluster's databases since its statistics began
 * (the sum of `pg_stat_database.deadlocks`), read through `psql` in the container, as
 * `openClientConnections` reads the listing. A backend writes its counters when it leaves, so a
 * reading after every client of a test has ended includes the deadlocks of its sessions.
 */
export async function deadlockCount(cluster: PostgresCluster): Promise<number> {
  const url = new URL(cluster.adminUrl);
  const result = await execInContainer(cluster.containerId, [
    'psql',
    '-U',
    decodeURIComponent(url.username),
    '-d',
    decodeURIComponent(url.pathname.slice(1)),
    '-v',
    'ON_ERROR_STOP=1',
    '-tAc',
    'select coalesce(sum(deadlocks), 0)::text from pg_stat_database',
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`reading the deadlock counter failed: ${result.output}`);
  }
  return Number(result.output.trim());
}
