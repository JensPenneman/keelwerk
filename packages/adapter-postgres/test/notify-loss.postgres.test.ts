import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { notifySender } from '../src/notify-sender.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import type { TestDatabase } from './support/test-database.ts';

let database: TestDatabase;
let owner: pg.Client;
let listener: pg.Client;
const ownerErrors: Error[] = [];
const notifications: string[] = [];
const warnings: string[] = [];
let onWarn: (message: string) => void = () => undefined;

beforeAll(async () => {
  database = await createTestDatabase('notify_loss');
  owner = new pg.Client({ connectionString: database.adminUrl });
  owner.on('error', (error) => ownerErrors.push(error));
  await owner.connect();
  listener = new pg.Client({ connectionString: database.adminUrl });
  listener.on('error', (error) => ownerErrors.push(error));
  listener.on('notification', (message) => notifications.push(message.payload ?? ''));
  await listener.connect();
  await listener.query('listen kw_events');
});

afterAll(async () => {
  await listener?.end();
  await owner?.end();
  expect(ownerErrors).toEqual([]);
});

const log = {
  debug: () => undefined,
  info: () => undefined,
  error: () => undefined,
  warn: (message: string) => {
    warnings.push(message);
    onWarn(message);
  },
};

async function notified(payload: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!notifications.includes(payload)) {
    if (Date.now() > deadline) throw new Error(`${payload} did not arrive`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('the notifier connection the server ends', () => {
  test('an idle connection that ended is dropped, the next wake-up opens another and arrives', async () => {
    const sender = notifySender({
      url: database.appUrl,
      applicationName: 'loss-notify',
      log: { ...log, child: () => log } as never,
    });
    try {
      await sender.send('first');
      await notified('first');
      const before = await owner.query<{ pid: number }>(
        'select pid from pg_stat_activity where application_name = $1',
        ['loss-notify-notify'],
      );
      expect(before.rows).toHaveLength(1);
      // The sender has dropped the connection once it logged that it failed.
      const dropped = new Promise<void>((resolve) => {
        onWarn = (message) => {
          if (message.startsWith('postgres notifier: the connection failed')) resolve();
        };
      });
      await owner.query('select pg_terminate_backend($1)', [before.rows[0]?.pid]);
      await dropped;
      await sender.send('second');
      await notified('second');
      const after = await owner.query<{ pid: number }>(
        'select pid from pg_stat_activity where application_name = $1',
        ['loss-notify-notify'],
      );
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0]?.pid).not.toBe(before.rows[0]?.pid);
    } finally {
      await sender.close();
    }
  });
});
