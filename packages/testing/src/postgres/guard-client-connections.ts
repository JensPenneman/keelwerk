import { afterAll, beforeAll } from 'vitest';
import { assertConnectionsClosed } from './assert-connections-closed.ts';
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
 * Registers, for the calling test file, a `beforeAll` that records the connections already open
 * and an `afterAll` that runs `assertConnectionsClosed` with those as `except`. Called from a
 * project's setup file. Setup-file hooks run last among the after hooks.
 */
export function guardClientConnections(
  cluster: PostgresCluster,
  options: { readonly timeoutMs?: number } = {},
): void {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  let baseline: readonly number[] = [];
  beforeAll(async () => {
    baseline = (await openClientConnections(cluster)).map((connection) => connection.pid);
  });
  afterAll(async () => {
    await assertConnectionsClosed(cluster, { except: baseline, timeoutMs });
  }, timeoutMs + 30_000);
}
