import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker, tickerStart } from './support/ticker-kit.ts';

const kits: TickerKit[] = [];
afterAll(async () => {
  await Promise.allSettled(kits.map((kit) => kit.stop()));
});

describe('the schedule ticker over one PostgreSQL database', () => {
  test('two runtimes on one database tick each tenant once', { timeout: 180_000 }, async () => {
    const database = await createTestDatabase('schedules_two_processes');
    const external = {
      factory: postgresAdapter({ ownerUrl: database.adminUrl }),
      url: database.appUrl,
    };
    const first = await bootTicker({ external });
    kits.push(first);
    const other = await bootTicker({
      external,
      join: {
        backendId: first.runtime.backendId,
        tenants: { acme: first.runtime.tenants.acme.id, globex: first.runtime.tenants.globex.id },
      },
    });
    kits.push(other);
    for (const minutes of [5, 10]) {
      const instant = tickerStart.add({ minutes, seconds: 31 });
      await first.advanceTo(instant);
      await other.advanceTo(instant);
      await first.advanceTo(instant);
    }
    for (const tenant of ['acme', 'globex'] as const) {
      const rows = (await first.rows(tenant, 'ticker.tick')).filter(
        (row) => row.schedule === 'everyTenant',
      );
      expect(rows.map((row) => row.at)).toEqual([
        tickerStart.add({ minutes: 5 }).toString(),
        tickerStart.add({ minutes: 10 }).toString(),
      ]);
    }
    expect(await first.rows('backend', 'ticker.beat')).toHaveLength(2);
  });
});
