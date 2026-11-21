import { describe, expect, inject, test } from 'vitest';
import { assertConnectionsClosed } from '../src/postgres/assert-connections-closed.ts';
import { deadlockCount } from '../src/postgres/deadlock-count.ts';
import { declareDeadlocks } from '../src/postgres/declare-deadlocks.ts';
import type { PostgresCluster } from '../src/postgres/postgres-cluster.ts';
import { provokeDeadlock } from './support/provoke-deadlock.ts';

const injected = inject('postgresCluster');
const cluster: PostgresCluster = {
  containerId: injected.containerId,
  adminUrl: injected.adminUrl,
};

describe('deadlockCount', () => {
  test('two clients that deadlock on purpose move the counter by exactly one, and the file declares it', async () => {
    const before = await deadlockCount(cluster);
    await provokeDeadlock(cluster.adminUrl, 'deadlock');
    await assertConnectionsClosed(cluster);
    expect((await deadlockCount(cluster)) - before).toBe(1);
    declareDeadlocks(1);
  });
});
