import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { LosingRelay } from '../support/losing-relay.ts';
import { startLosingRelay } from '../support/losing-relay.ts';
import type { TickerKit } from './support/ticker-kit.ts';
import { bootTicker } from './support/ticker-kit.ts';

let relay: LosingRelay | undefined;
let kit: TickerKit | undefined;

beforeAll(async () => {
  const database = await createTestDatabase('commit_loss_runtime');
  relay = await startLosingRelay(database.appUrl);
  // No workers: the command is the only unit that writes.
  kit = await bootTicker({
    workers: false,
    logger: recordingLogger([]),
    external: {
      factory: postgresAdapter({ ownerUrl: database.adminUrl, applicationName: 'commit-loss' }),
      url: relay.url,
    },
  });
});

afterAll(async () => {
  await kit?.stop();
  await relay?.close();
});

test('a connection that loses the answer to a commit that the server made: the command answers core.unavailable, the row is there, and the same command id answers the recorded outcome and runs nothing twice', {
  timeout: 60_000,
}, async () => {
  if (kit === undefined || relay === undefined) throw new Error('the test did not start');
  const schedule = `commit-loss-${crypto.randomUUID()}`;
  const ticks = async () =>
    (await kit?.rows('acme', 'ticker.tick'))?.filter((row) => row.schedule === schedule) ?? [];
  // The value that only this command's unit writes: the relay arms for the one transaction that
  // sends it. The first command of a scope also commits a transaction of its own before its unit,
  // the insert of the scope's data key (`kw__control.kw_scope_keys`); that and every other
  // transaction, on any connection, passes untouched.
  const input = { schedule, at: 'once' };
  const commandId = crypto.randomUUID();
  relay.loseCommitOf(schedule);
  const unknown = await kit.call('acme', 'ticker.recordTick', input, commandId);
  // The relay says which transaction it cut: the command's own, the one that inserted the tick
  // row, on a connection of the app's placement; a cut of any other fails here with what it saw.
  expect(relay.cuts()).toHaveLength(1);
  const [cut] = relay.cuts();
  expect(cut?.application).toBe('commit-loss');
  expect(cut?.markedBy).toMatch(/^insert into .*ticker/i);
  expect(cut?.statements.at(-1)).toMatch(/^commit$/i);
  expect(unknown.ok).toBe(false);
  expect(unknown.ok === false && unknown.error.code).toBe('core.unavailable');
  expect(unknown.ok === false && unknown.error.retryable).toBe(true);
  // The server committed: the row is there, though the caller was told the database was
  // unreachable.
  expect(await ticks()).toHaveLength(1);
  // The caller sends the same command id again: the receipt answers, and the command does not run
  // again.
  const again = await kit.call('acme', 'ticker.recordTick', input, commandId);
  expect(again.ok).toBe(true);
  expect(await ticks()).toHaveLength(1);
  // A command with another id is a new command.
  expect((await kit.call('acme', 'ticker.recordTick', input, crypto.randomUUID())).ok).toBe(true);
  expect(await ticks()).toHaveLength(2);
  expect(relay.cuts()).toHaveLength(1);
});
