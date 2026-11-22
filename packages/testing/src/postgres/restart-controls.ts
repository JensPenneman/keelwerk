import { assertDeadlocksKept } from './assert-deadlocks-kept.ts';
import { deadlockCount } from './deadlock-count.ts';
import { execInContainer } from './exec-in-container.ts';
import type { PostgresCluster } from './postgres-cluster.ts';
import { serverOptions } from './server-options.ts';

async function run(containerId: string, what: string, command: readonly string[]): Promise<void> {
  const result = await execInContainer(containerId, command, { user: 'postgres' });
  if (result.exitCode !== 0) throw new Error(`${what} failed: ${result.output}`);
}

/** `stopServer` and `startServer` of a restartable container. */
export function restartControls(cluster: PostgresCluster): {
  stopServer(): Promise<void>;
  startServer(): Promise<void>;
} {
  let seen: number | undefined;
  return {
    stopServer: async () => {
      seen = await deadlockCount(cluster);
      await run(cluster.containerId, 'stopping the server', [
        'pg_ctl',
        'stop',
        '-m',
        'fast',
        '-w',
        '-t',
        '60',
      ]);
    },
    startServer: async () => {
      await run(cluster.containerId, 'starting the server', [
        'pg_ctl',
        'start',
        '-w',
        '-t',
        '60',
        '-l',
        '/tmp/postgres-restart.log',
        '-o',
        serverOptions.join(' '),
      ]);
      if (seen !== undefined) assertDeadlocksKept(seen, await deadlockCount(cluster));
    },
  };
}
