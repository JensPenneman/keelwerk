import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import { tickerKeyDigest } from './support/ticker-key-digest.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

describe('enqueue key owners on PostgreSQL', () => {
  const kits: TickerKit[] = [];
  afterAll(async () => {
    await Promise.allSettled(kits.map((kit) => kit.stop()));
  });

  test('two modules of one scope keep their own keyed job on PostgreSQL', {
    timeout: 60_000,
  }, async () => {
    const database = await createTestDatabase('enqueue_key_owners');
    const external = {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    };
    const kit = await bootTicker({ external });
    kits.push(kit);
    const runAt = seededAt.add({ minutes: 2 });
    const input = { runAt: runAt.toString() };
    expect((await kit.call('acme', 'ticker.escalateLater', { at: 't', ...input })).ok).toBe(true);
    expect((await kit.call('acme', 'echo.enqueueLater', { at: 'e', ...input })).ok).toBe(true);
    const keys = kit.spy.enqueued
      .map((entry) => entry.job)
      .filter((job) => job.queue === 'commands' && job.key !== undefined)
      .map((job) => job.key?.value);
    // The stored key is the module and the digest of the key under that module, never the text.
    expect(keys).toEqual([
      `ticker:${await tickerKeyDigest(kit, 'ticker', 'later')}`,
      `echo:${await tickerKeyDigest(kit, 'echo', 'later')}`,
    ]);
    expect(JSON.stringify(keys)).not.toContain('later');
    await kit.advanceTo(runAt);
    const tickerRuns = (await kit.rows('backend', 'ticker.beat'))
      .filter((row) => row.source === 'later')
      .map((row) => row.at);
    expect(tickerRuns).toEqual(['t']);
    expect((await kit.rows('acme', 'echo.tick')).map((row) => row.at)).toEqual(['e']);
  });
});
