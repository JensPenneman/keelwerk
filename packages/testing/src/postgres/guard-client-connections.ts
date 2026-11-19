import { afterAll, beforeAll } from 'vitest';
import { assertConnectionsClosed } from './assert-connections-closed.ts';
import { openClientConnections } from './open-client-connections.ts';
import type { PostgresCluster } from './postgres-cluster.ts';

const defaultTimeoutMs = 10_000;

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
