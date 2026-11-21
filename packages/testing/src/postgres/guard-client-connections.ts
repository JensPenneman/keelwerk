import { afterAll, beforeAll } from 'vitest';
import { assertConnectionsClosed } from './assert-connections-closed.ts';
import { deadlockCount } from './deadlock-count.ts';
import { declaredDeadlocks } from './declared-deadlocks.ts';
import { openClientConnections } from './open-client-connections.ts';
import type { PostgresCluster } from './postgres-cluster.ts';

/**
 * The minimum grace the guard gives the backends of an ended pool or client to be gone. After a
 * correct close the first listing already comes back clean (at most 55 ms over 80 PostgreSQL files
 * on a Mac, the time of the listing itself); 2000 ms is far above that and far below pg-pool's
 * 10 000 ms idle timeout: a bound at or above it would let a pool that was never ended pass by
 * removing its own idle clients before the last listing. It is a grace and not a limit: a failure
 * rests only on a listing that started after it, so a slow listing cannot fail a clean file.
 */
const defaultTimeoutMs = 2000;

/**
 * Registers, for the calling test file, a `beforeAll` that records the connections already open and
 * the cluster's deadlock counter, and an `afterAll` that runs `assertConnectionsClosed` with those
 * connections as `except` and then fails the file when the deadlock counter moved by other than the
 * deadlocks its cases declared (`declareDeadlocks`). The counter is the cluster's: the guard knows no
 * file's databases, and a project's PostgreSQL files run one at a time on its cluster. The reading
 * follows the check of the connections, because a backend writes its counters before it leaves.
 * Called from a project's setup file. Setup-file hooks run last among the after hooks.
 */
export function guardClientConnections(
  cluster: PostgresCluster,
  options: { readonly timeoutMs?: number } = {},
): void {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  let baseline: readonly number[] = [];
  let deadlocksBefore = 0;
  beforeAll(async () => {
    declaredDeadlocks.count = 0;
    baseline = (await openClientConnections(cluster)).map((connection) => connection.pid);
    deadlocksBefore = await deadlockCount(cluster);
  });
  afterAll(async () => {
    await assertConnectionsClosed(cluster, { except: baseline, timeoutMs });
    const moved = (await deadlockCount(cluster)) - deadlocksBefore;
    const declared = declaredDeadlocks.count;
    declaredDeadlocks.count = 0;
    if (moved !== declared) {
      throw new Error(
        `The test file moved the PostgreSQL deadlock counter by ${moved} and declared ${declared}. ` +
          'A deadlock that PostgreSQL ends and a unit survives by a retry is a defect to remove; a case that provokes deadlocks on purpose calls declareDeadlocks(count) with how many it provokes.',
      );
    }
  }, timeoutMs + 30_000);
}
