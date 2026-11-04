import { setTimeout as delay } from 'node:timers/promises';
import type { AdapterCapabilities, DataAdapter } from '@keelwerk/core';
import { fallbackReport } from '@keelwerk/data';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import { streamAppend } from './support/event-fixtures.ts';
import type { FeedHarness } from './support/feed-harness.ts';
import { feedHarness } from './support/feed-harness.ts';
import { known } from './support/store-rows.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

let harness: FeedHarness;
let plain: DataAdapter;
let plainCapabilities: AdapterCapabilities;
let off: DataAdapter;
let offCapabilities: AdapterCapabilities;

beforeAll(async () => {
  harness = await feedHarness('accelerations_off');
  const placement = {
    id: 'main',
    url: harness.database.appUrl,
    strategy: 'shared-tables' as const,
    pool: { max: 4 },
  };
  plain = postgresAdapter({ entities: (ref) => known.get(ref) }).create(
    placement,
    testEnvironment(),
  );
  plainCapabilities = await plain.connect();
  off = postgresAdapter({
    entities: (ref) => known.get(ref),
    accelerations: { rowLocks: false, notify: false },
  }).create(placement, testEnvironment());
  offCapabilities = await off.connect();
});

afterAll(async () => {
  await plain.close(5000);
  await off.close(5000);
  await harness.close();
});

describe('accelerations switched off', () => {
  test('the default adapter reports row locks and the notify feed', () => {
    expect(plainCapabilities.rowLocks).toEqual({ skipLocked: true, noWait: true });
    expect(plainCapabilities.changeFeed).toBe('notify');
    expect(fallbackReport(plainCapabilities).map((row) => row.capability)).toEqual([
      'search',
      'broadcast',
      'encryptedQueries.order',
      'encryptedQueries.tagSets',
    ]);
  });

  test('rowLocks false and notify false report rowLocks false and a poll feed', () => {
    expect(offCapabilities.rowLocks).toBe(false);
    expect(offCapabilities.changeFeed).toBe('poll');
    expect(off.feed.level).toBe('poll');
    expect(fallbackReport(offCapabilities).map((row) => row.capability)).toEqual(
      expect.arrayContaining(['rowLocks', 'changeFeed']),
    );
  });

  test('units still run and commit events, send no NOTIFY and open no LISTEN session', async () => {
    await off.unit(testNamespace, testScopes.scopeA, async (u) => {
      await u.events.append([streamAppend(1, [1])]);
    });
    await delay(250);
    expect(harness.notifications).toEqual([]);
    const stop = new AbortController();
    const wakes = off.feed.wake([testNamespace], stop.signal)[Symbol.asyncIterator]();
    const first = await wakes.next();
    expect(first.value).toEqual({ namespace: 'ns-app', scopeIds: [testScopes.tenantA] });
    const listeners = await harness.owner(async (client) =>
      client.query<{ count: string }>(
        `select count(*)::text as count from pg_stat_activity where datname = current_database() and application_name like '%-listen'`,
      ),
    );
    expect(listeners.rows[0]?.count).toBe('0');
    stop.abort();
  });
});
