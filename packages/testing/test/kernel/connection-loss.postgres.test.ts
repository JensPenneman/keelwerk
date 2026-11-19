import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker } from './support/ticker-kit.ts';

let owner: pg.Client | undefined;
let kit: TickerKit | undefined;
const ownerErrors: Error[] = [];

beforeAll(async () => {
  const database = await createTestDatabase('connection_loss_runtime');
  owner = new pg.Client({ connectionString: database.adminUrl });
  owner.on('error', (error) => ownerErrors.push(error));
  await owner.connect();
  kit = await bootTicker({
    external: {
      factory: postgresAdapter({ ownerUrl: database.adminUrl, applicationName: 'loss-runtime' }),
      url: database.appUrl,
    },
  });
});

afterAll(async () => {
  await kit?.stop();
  await owner?.end();
  expect(ownerErrors).toEqual([]);
});

test('a runtime whose connections the server ends answers the next command ok or core.unavailable, and the one after ok', {
  timeout: 60_000,
}, async () => {
  if (kit === undefined || owner === undefined) throw new Error('the test did not start');
  expect((await kit.call('acme', 'ticker.armTimer', { at: 'one' })).ok).toBe(true);
  await owner.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name like 'loss-runtime%'",
  );
  const next = await kit.call('acme', 'ticker.armTimer', { at: 'two' });
  if (!next.ok) expect(next.error.code).toBe('core.unavailable');
  expect((await kit.call('acme', 'ticker.armTimer', { at: 'three' })).ok).toBe(true);
});
