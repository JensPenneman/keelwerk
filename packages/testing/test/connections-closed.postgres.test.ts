import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest';
import { assertConnectionsClosed } from '../src/postgres/assert-connections-closed.ts';
import { openClientConnections } from '../src/postgres/open-client-connections.ts';
import type { PostgresCluster } from '../src/postgres/postgres-cluster.ts';

const injected = inject('postgresCluster');
const cluster: PostgresCluster = {
  containerId: injected.containerId,
  adminUrl: injected.adminUrl,
};

let client: pg.Client | undefined;

async function open(): Promise<pg.Client> {
  const opened = new pg.Client({
    connectionString: cluster.adminUrl,
    // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
    application_name: 'left-open',
  });
  opened.on('error', () => undefined);
  await opened.connect();
  return opened;
}

beforeAll(async () => {
  await assertConnectionsClosed(cluster);
});

afterAll(async () => {
  await client?.end();
});

describe('assertConnectionsClosed', () => {
  test('assertConnectionsClosed names a connection left open and passes once it is ended', async () => {
    client = await open();
    await expect(assertConnectionsClosed(cluster, { timeoutMs: 300 })).rejects.toThrow(
      /left 1 PostgreSQL connection\(s\) open: pid \d+ "left-open" on /,
    );
    await client.end();
    client = undefined;
    await expect(assertConnectionsClosed(cluster, { timeoutMs: 5000 })).resolves.toBeUndefined();
  });

  test('a connection open before the baseline is not counted', async () => {
    client = await open();
    const baseline = (await openClientConnections(cluster)).map((connection) => connection.pid);
    await expect(
      assertConnectionsClosed(cluster, { except: baseline, timeoutMs: 300 }),
    ).resolves.toBeUndefined();
  });
});
