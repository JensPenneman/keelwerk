import { setTimeout as delay } from 'node:timers/promises';
import type { DataAdapter } from '@keelwerk/core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
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
