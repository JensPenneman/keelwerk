import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { HoldingRelay } from '../support/holding-relay.ts';
import { startHoldingRelay } from '../support/holding-relay.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker } from './support/ticker-kit.ts';

let owner: pg.Client | undefined;
let relay: HoldingRelay | undefined;
let kit: TickerKit | undefined;
const ownerErrors: Error[] = [];

beforeAll(async () => {
  const database = await createTestDatabase('connection_loss_runtime');
  owner = new pg.Client({ connectionString: database.adminUrl });
  owner.on('error', (error) => ownerErrors.push(error));
  await owner.connect();
  relay = await startHoldingRelay(database.appUrl);
  // No workers: no unit waits for an answer when the relay starts to hold.
  kit = await bootTicker({
    workers: false,
    external: {
      factory: postgresAdapter({ ownerUrl: database.adminUrl, applicationName: 'loss-runtime' }),
      url: relay.url,
    },
  });
});

afterAll(async () => {
  await kit?.stop();
  await relay?.close();
  await owner?.end();
  expect(ownerErrors).toEqual([]);
});

test('a runtime whose connections the server ended answers the next commands ok, even before the pool has read that they ended', {
  timeout: 60_000,
}, async () => {
  if (kit === undefined || owner === undefined || relay === undefined) {
    throw new Error('the test did not start');
  }
  const { runtime } = kit;
  const scope = kit.scopeOf('acme');
  // Three units at once, so the pool holds at least three connections.
  let inside = 0;
  let allInside: () => void = () => undefined;
  const met = new Promise<void>((resolve) => {
    allInside = resolve;
  });
  await Promise.all(
    [0, 1, 2].map(() =>
      runtime.sealed.unit(runtime.namespace, scope, async () => {
        inside += 1;
        if (inside === 3) allInside();
        await met;
      }),
    ),
  );
  expect((await kit.call('acme', 'ticker.armTimer', { at: 'one' })).ok).toBe(true);
  // The relay keeps back what the server says on every connection open now, their end included, so
  // the pool cannot have read that they ended when the next commands draw them.
  relay.hold();
  await owner.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name like 'loss-runtime%'",
  );
  expect(await kit.call('acme', 'ticker.armTimer', { at: 'two' })).toMatchObject({ ok: true });
  expect(await kit.call('acme', 'ticker.armTimer', { at: 'three' })).toMatchObject({ ok: true });
});
