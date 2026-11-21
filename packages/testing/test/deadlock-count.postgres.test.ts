import pg from 'pg';
import { afterAll, describe, expect, inject, test } from 'vitest';
import { assertConnectionsClosed } from '../src/postgres/assert-connections-closed.ts';
import { deadlockCount } from '../src/postgres/deadlock-count.ts';
import { declareDeadlocks } from '../src/postgres/declare-deadlocks.ts';
import type { PostgresCluster } from '../src/postgres/postgres-cluster.ts';

const injected = inject('postgresCluster');
const cluster: PostgresCluster = {
  containerId: injected.containerId,
  adminUrl: injected.adminUrl,
};

const clients: pg.Client[] = [];

async function open(applicationName: string): Promise<pg.Client> {
  const opened = new pg.Client({
    connectionString: cluster.adminUrl,
    // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
    application_name: applicationName,
  });
  opened.on('error', () => undefined);
  await opened.connect();
  clients.push(opened);
  return opened;
}

afterAll(async () => {
  await Promise.all(clients.map(async (client) => client.end()));
});

describe('deadlockCount', () => {
  test('two clients that deadlock on purpose move the counter by exactly one, and the file declares it', async () => {
    const before = await deadlockCount(cluster);
    const first = await open('deadlock-first');
    const second = await open('deadlock-second');
    await first.query('begin');
    await second.query('begin');
    await first.query('select pg_advisory_xact_lock(7001)');
    await second.query('select pg_advisory_xact_lock(7002)');
    const firstAsks = first.query('select pg_advisory_xact_lock(7002)');
    // The first waits for the lock the second holds, for certain; only then does the second ask.
    for (;;) {
      const waiting = await second.query(
        `select 1 from pg_stat_activity where application_name = 'deadlock-first' and wait_event_type = 'Lock'`,
      );
      if (waiting.rowCount !== 0) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const secondAsks = second.query('select pg_advisory_xact_lock(7001)');
    const outcomes = await Promise.allSettled([firstAsks, secondAsks]);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(
      outcomes.flatMap((outcome) =>
        outcome.status === 'rejected' ? [(outcome.reason as { code?: string }).code] : [],
      ),
    ).toEqual(['40P01']);
    await first.query('rollback');
    await second.query('rollback');
    await Promise.all(clients.splice(0).map(async (client) => client.end()));
    await assertConnectionsClosed(cluster);
    expect((await deadlockCount(cluster)) - before).toBe(1);
    declareDeadlocks(1);
  });
});
