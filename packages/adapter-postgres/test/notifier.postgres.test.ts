import { createServer, type Server, type Socket, connect as tcpConnect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { DataAdapter } from '@keelwerk/core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { notifySender } from '../src/notify-sender.ts';
import { createPostgresChangeFeed } from '../src/postgres-change-feed.ts';
import { streamAppend } from './support/event-fixtures.ts';
import type { FeedHarness } from './support/feed-harness.ts';
import { feedHarness } from './support/feed-harness.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const { scopeA, scopeB, tenantA, tenantB } = testScopes;

let harness: FeedHarness;
let adapter: DataAdapter;
let stream = 0;

beforeAll(async () => {
  harness = await feedHarness('notifier');
  adapter = await harness.adapter();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.owner(async (client) => {
    const tables = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'app' and tablename like 'kw\\_%'`,
    );
    await client.query(
      `truncate ${tables.rows.map((table) => `app.${table.tablename}`).join(', ')} restart identity`,
    );
  });
  await delay(120);
  harness.notifications.length = 0;
});

const append = async (scope: typeof scopeA, a: DataAdapter = adapter): Promise<void> => {
  stream += 1;
  const n = stream;
  await a.unit(testNamespace, scope, async (u) => {
    await u.events.append([streamAppend(n, [n])]);
  });
};

describe('the notifier on PostgreSQL', () => {
  test('a commit that appended events sends one wake-up naming the namespace and the scope', async () => {
    await append(scopeA);
    expect(await harness.arrived(1, 3000)).toEqual([`ns-app:${tenantA}`]);
  });

  test('nothing is sent while the writer is still inside its transaction', async () => {
    await adapter.unit(testNamespace, scopeA, async (u) => {
      stream += 1;
      await u.events.append([streamAppend(stream, [stream])]);
      await delay(250);
      expect(harness.notifications).toEqual([]);
    });
    expect(await harness.arrived(1, 3000)).toEqual([`ns-app:${tenantA}`]);
  });

  test('a rolled-back unit and a read-only unit send nothing', async () => {
    await expect(
      adapter.unit(testNamespace, scopeA, async (u) => {
        stream += 1;
        await u.events.append([streamAppend(stream, [stream])]);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    await adapter.unit(testNamespace, scopeA, async (u) => u.events.head(), { readOnly: true });
    await delay(250);
    expect(harness.notifications).toEqual([]);
  });

  test('a burst of commits in two scopes is coalesced into a few wake-ups that name both', async () => {
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 10 }, async (_unused, i) => append(i % 2 === 0 ? scopeA : scopeB)),
    );
    const elapsedMs = performance.now() - started;
    await harness.arrived(1, 3000);
    await delay(250);
    const seen = harness.notifications;
    expect(seen.length).toBeLessThan(10);
    expect(seen.length).toBeLessThanOrEqual(Math.ceil(elapsedMs / 50) + 1);
    const scopes = new Set(seen.flatMap((payload) => payload.slice('ns-app:'.length).split(',')));
    expect(scopes).toEqual(new Set([tenantA, tenantB]));
  });
});

describe('the change feed on PostgreSQL', () => {
  test('is notify, and wakes after a commit with the namespace and scope', async () => {
    expect(adapter.feed.level).toBe('notify');
    const stop = new AbortController();
    const wakes = adapter.feed.wake([testNamespace], stop.signal)[Symbol.asyncIterator]();
    const first = wakes.next();
    await append(scopeA);
    expect((await first).value).toMatchObject({ namespace: 'ns-app' });
    const seen = new Set<string>();
    let next = await first;
    for (const id of next.value?.scopeIds ?? []) seen.add(id);
    while (!seen.has(tenantA)) {
      next = await wakes.next();
      for (const id of next.value?.scopeIds ?? []) seen.add(id);
    }
    expect(seen.has(tenantA)).toBe(true);
    stop.abort();
    expect((await wakes.next()).done).toBe(true);
  });

  test('a lost notification is recovered by polling the heads', async () => {
    // The writer has notify off, so its commit sends nothing: only the reader's poll can find it.
    const silent = await harness.adapter({ accelerations: { notify: false } });
    const stop = new AbortController();
    const wakes = adapter.feed.wake([testNamespace], stop.signal)[Symbol.asyncIterator]();
    const first = wakes.next();
    await delay(100);
    await append(scopeB, silent);
    const found = await Promise.race([
      first,
      delay(6000).then(() => {
        throw new Error('no wake-up within six seconds');
      }),
    ]);
    expect(found.value).toEqual({ namespace: 'ns-app', scopeIds: [tenantB] });
    expect(harness.notifications).toEqual([]);
    stop.abort();
  });

  test('a namespace-wide wake-up lists every scope that has events', async () => {
    await append(scopeA);
    await append(scopeB);
    const stop = new AbortController();
    const wakes = adapter.feed.wake([testNamespace], stop.signal)[Symbol.asyncIterator]();
    const both = new Set([tenantA, tenantB]);
    // The commits' own wake-ups and the first poll may arrive in pieces; wait until both are named.
    const seen = new Set<string>();
    while (seen.size < both.size) {
      for (const id of (await wakes.next()).value?.scopeIds ?? []) seen.add(id);
    }
    expect(seen).toEqual(both);
    // Past the pieces, a namespace-wide payload names every scope in one wake-up.
    await delay(1500);
    await harness.owner(async (client) =>
      client.query(`select pg_notify('kw_events', 'ns-app:*')`),
    );
    let wide = await wakes.next();
    while (wide.value?.scopeIds.length !== both.size) wide = await wakes.next();
    expect(new Set(wide.value.scopeIds)).toEqual(both);
    stop.abort();
  });
});

describe('the listen connection on PostgreSQL', () => {
  test('is opened again after its backend is terminated, and wakes again', async () => {
    const feed = createPostgresChangeFeed({
      url: harness.database.appUrl,
      applicationName: 'reconnect',
      log: testEnvironment().log,
      adapter,
      notify: true,
      pollIntervalMs: 60_000,
    });
    const stop = new AbortController();
    const wakes = feed.source.wake([testNamespace], stop.signal)[Symbol.asyncIterator]();
    // The tables are empty and the poll runs once a minute: only a notification can wake the reader.
    const next = wakes.next();
    await delay(500);
    await harness.owner(async (client) =>
      client.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'reconnect-listen'`,
      ),
    );
    await delay(2500);
    await harness.owner(async (client) =>
      client.query(`select pg_notify('kw_events', 'ns-app:${tenantA}')`),
    );
    const found = await Promise.race([
      next,
      delay(5000).then(() => {
        throw new Error('no wake-up after the listen connection was reopened');
      }),
    ]);
    expect(found.value).toEqual({ namespace: 'ns-app', scopeIds: [tenantA] });
    stop.abort();
    await feed.close(2000);
  });
});

describe('the notify connection after the feed closed', () => {
  const backends = async (name: string): Promise<number> =>
    harness.owner(async (client) => {
      const found = await client.query<{ count: string }>(
        'select count(*) from pg_stat_activity where application_name = $1',
        [name],
      );
      return Number(found.rows[0]?.count);
    });

  /**
   * A TCP relay in front of the database that forwards what a client sends at once but holds back
   * the end of the server's start-up answer until `release()`: a connection opened through it stays "opening" on the
   * client side while its backend already shows in `pg_stat_activity`.
   */
  const slowRelay = async (
    target: URL,
  ): Promise<{ readonly url: string; release(): void; stop(): Promise<void> }> => {
    let held = true;
    const sockets = new Set<Socket>();
    const releases: Array<() => void> = [];
    const server: Server = createServer((client) => {
      const upstream = tcpConnect(Number(target.port), target.hostname);
      sockets.add(client).add(upstream);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      client.pipe(upstream);
      // The backend reports its application name once it has authenticated, and the driver's connect
      // resolves at the server's "ready for query" message: that message, and every answer after it,
      // waits for the release.
      const readyForQuery = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
      let holding = false;
      const queued: Buffer[] = [];
      upstream.on('data', (chunk: Buffer) => {
        if (held && !holding && chunk.subarray(-readyForQuery.length).equals(readyForQuery)) {
          holding = true;
        }
        if (holding && held) queued.push(chunk);
        else client.write(chunk);
      });
      upstream.on('end', () => client.end());
      releases.push(() => {
        for (const chunk of queued.splice(0)) client.write(chunk);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The relay has no port');
    const url = new URL(target);
    url.hostname = '127.0.0.1';
    url.port = String(address.port);
    return {
      url: url.toString(),
      release: () => {
        held = false;
        for (const forward of releases.splice(0)) forward();
      },
      stop: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  };

  const waitForBackends = async (
    name: string,
    done: (count: number) => boolean,
    timeoutMs: number,
  ): Promise<number> => {
    const deadline = Date.now() + timeoutMs;
    let count = await backends(name);
    while (!done(count) && Date.now() < deadline) {
      await delay(25);
      count = await backends(name);
    }
    return count;
  };

  test('a wake-up pending when a close with no deadline expires opens no connection', async () => {
    const relay = await slowRelay(new URL(harness.database.appUrl));
    const feed = createPostgresChangeFeed({
      url: relay.url,
      applicationName: 'lateflush',
      log: testEnvironment().log,
      adapter,
      notify: true,
      pollIntervalMs: 60_000,
    });
    try {
      // The first flush is in flight: its connection is opening and the relay holds the answer.
      feed.committed(testNamespace.id, tenantA);
      expect(await waitForBackends('lateflush-notify', (count) => count > 0, 5000)).toBeGreaterThan(
        0,
      );
      // A second wake-up is pending while it flushes, so the trailing flush after the close has work.
      feed.committed(testNamespace.id, tenantB);
      const closing = feed.close(0);
      relay.release();
      await closing;
      expect(await waitForBackends('lateflush-notify', (count) => count === 0, 5000)).toBe(0);
    } finally {
      relay.release();
      await relay.stop();
    }
  });

  test('a sender that is closed sends nothing and opens no connection', async () => {
    const sender = notifySender({
      url: harness.database.appUrl,
      applicationName: 'closedsender',
      log: testEnvironment().log,
    });
    await sender.close();
    await sender.send('ns-app:x');
    expect(await backends('closedsender-notify')).toBe(0);
  });
});
