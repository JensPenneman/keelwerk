import { postgresAdapter } from '@keelwerk/adapter-postgres';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { HoldingRelay } from '../support/holding-relay.ts';
import { startHoldingRelay } from '../support/holding-relay.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker } from './support/ticker-kit.ts';

let owner: pg.Client | undefined;
let listener: pg.Client | undefined;
let relay: HoldingRelay | undefined;
let kit: TickerKit | undefined;
const ownerErrors: Error[] = [];
const lines: LoggedLine[] = [];
const notifications: string[] = [];

beforeAll(async () => {
  const database = await createTestDatabase('notify_loss_runtime');
  owner = new pg.Client({ connectionString: database.adminUrl });
  owner.on('error', (error) => ownerErrors.push(error));
  await owner.connect();
  // The channel of the workers' wake-ups: a command that enqueues a job sends one.
  listener = new pg.Client({ connectionString: database.adminUrl });
  listener.on('error', (error) => ownerErrors.push(error));
  listener.on('notification', (message) => notifications.push(message.payload ?? ''));
  await listener.connect();
  await listener.query('listen kw_jobs');
  relay = await startHoldingRelay(database.appUrl);
  // No workers: no unit waits for an answer when the relay starts to hold.
  kit = await bootTicker({
    workers: false,
    logger: recordingLogger(lines),
    external: {
      factory: postgresAdapter({ ownerUrl: database.adminUrl, applicationName: 'loss-notify' }),
      url: relay.url,
    },
  });
});

afterAll(async () => {
  await kit?.stop();
  await relay?.close();
  await listener?.end();
  await owner?.end();
  expect(ownerErrors).toEqual([]);
});

/** The backends of the runtime's connections that the server still has. */
async function backends(): Promise<number> {
  const found = await owner?.query(
    "select 1 from pg_stat_activity where application_name like 'loss-notify%' and datname = current_database()",
  );
  return found?.rowCount ?? -1;
}

/** Resolves once `condition` holds; it fails with what it saw when 15 s pass first. */
async function until(label: string, condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(
        `${label}: ${JSON.stringify({ notifications, lines: lines.map((line) => line.message) })}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('a wake-up whose connection the server ended, with the end held back until the send, fails and is logged, and the next commit wakes the reader', {
  timeout: 60_000,
}, async () => {
  if (kit === undefined || owner === undefined || relay === undefined) {
    throw new Error('the test did not start');
  }
  const unsent = (): number =>
    lines.filter((line) => line.message === 'postgres notifier: a wake-up was not sent').length;
  // A commit that enqueues a job sends a wake-up, which opens the notify connection.
  const first = notifications.length;
  expect((await kit.call('acme', 'ticker.escalate', { at: 'one' })).ok).toBe(true);
  await until('the first wake-up', () => notifications.length > first);
  // The relay keeps the end of every connection back, the notify connection's too, until the next
  // write there.
  relay.hold();
  await owner.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name like 'loss-notify%' and datname = current_database()",
  );
  await until('the end of the connections', async () => (await backends()) === 0);
  const failed = unsent();
  expect((await kit.call('acme', 'ticker.escalate', { at: 'two' })).ok).toBe(true);
  await until('the failed send', () => unsent() > failed);
  const seen = notifications.length;
  expect((await kit.call('acme', 'ticker.escalate', { at: 'three' })).ok).toBe(true);
  await until('the wake-up after it', () => notifications.length > seen);
});
