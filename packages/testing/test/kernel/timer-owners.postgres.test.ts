import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { splitTimerKey } from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

describe('timer owners on PostgreSQL', () => {
  const kits: TickerKit[] = [];
  afterAll(async () => {
    await Promise.allSettled(kits.map((kit) => kit.stop()));
  });

  test('two modules of one scope keep their own timer of one key on PostgreSQL', {
    timeout: 60_000,
  }, async () => {
    const database = await createTestDatabase('timer_owners');
    const external = {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    };
    const kit = await bootTicker({ external });
    kits.push(kit);
    expect((await kit.call('acme', 'ticker.armTimer', { at: 't' })).ok).toBe(true);
    expect((await kit.call('acme', 'echo.armTimer', { at: 'e' })).ok).toBe(true);
    expect((await kit.call('acme', 'ticker.disarm', {})).ok).toBe(true);
    await kit.advanceTo(seededAt.add({ seconds: 46 }));
    expect((await kit.rows('acme', 'echo.tick')).map((row) => row.at)).toEqual(['e']);
    expect(
      (await kit.rows('acme', 'ticker.tick')).filter((row) => row.schedule === 'timer'),
    ).toHaveLength(0);
    const keys = kit.spy.enqueued
      .map((entry) => entry.job)
      .filter((job) => job.queue === 'timers')
      .map((job) =>
        splitTimerKey(job.key?.value ?? '', {
          kind: job.kind,
          principalId: job.principal.principalId,
        }),
      );
    expect(keys).toEqual([
      { module: 'ticker', key: 'pulse' },
      { module: 'echo', key: 'pulse' },
    ]);
  });
});
