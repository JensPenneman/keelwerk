import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, seededAt } from './support/ticker-kit.ts';

const kits: TickerKit[] = [];
afterAll(async () => {
  await Promise.allSettled(kits.map((kit) => kit.stop()));
});

describe('a cross-scope enqueue over one PostgreSQL database', () => {
  test('a job committed by a runtime that stops before any worker ran is run by another runtime', {
    timeout: 180_000,
  }, async () => {
    const database = await createTestDatabase('cross_scope_crash');
    const external = {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    };
    // The first runtime has no worker: its commit leaves the backend command's job in the tenant's lane and nothing else.
    const first = await bootTicker({ external, workers: false });
    kits.push(first);
    const sent = await first.call('acme', 'ticker.escalateLater', {
      at: 'survived',
      runAt: seededAt.add({ minutes: 2 }).toString(),
    });
    expect(sent.ok).toBe(true);
    expect(await first.rows('backend', 'ticker.beat')).toHaveLength(0);
    await first.stop();
    const other = await bootTicker({
      external,
      join: {
        backendId: first.runtime.backendId,
        tenants: { acme: first.runtime.tenants.acme.id, globex: first.runtime.tenants.globex.id },
      },
    });
    kits.push(other);
    // The user's job is resolved again by the other runtime: it must know the user, as it would from a session.
    expect((await other.call('acme', 'ticker.disarm', {})).ok).toBe(true);
    await other.advanceTo(seededAt.add({ minutes: 2 }));
    const beats = await other.rows('backend', 'ticker.beat');
    expect(beats.filter((row) => row.source === 'later').map((row) => row.at)).toEqual([
      'survived',
    ]);
  });
});
