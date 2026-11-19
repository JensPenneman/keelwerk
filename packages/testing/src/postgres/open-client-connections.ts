import type { ClientConnection } from './client-connection.ts';
import { execInContainer } from './exec-in-container.ts';
import type { PostgresCluster } from './postgres-cluster.ts';

const listing =
  "select coalesce(json_agg(json_build_object('pid', pid, 'applicationName', coalesce(application_name, ''), 'database', coalesce(datname, ''), 'state', coalesce(state, ''))), '[]') " +
  "from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid() and datname is not null and coalesce(application_name, '') <> 'pg_isready'";

/**
 * The client backends of the cluster except the probe's own, read through `psql` in the container,
 * so the probe is never a connection of the test process that could fail unhandled itself. The
 * container's own health check (`pg_isready`) and a backend that has not yet chosen a database are
 * not clients of the test and are left out.
 */
export async function openClientConnections(
  cluster: PostgresCluster,
): Promise<readonly ClientConnection[]> {
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
    listing,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`listing the open connections failed: ${result.output}`);
  }
  return JSON.parse(result.output.trim()) as readonly ClientConnection[];
}
