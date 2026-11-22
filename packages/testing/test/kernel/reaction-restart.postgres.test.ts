import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import type { RestartablePostgres } from '../../src/postgres/index.ts';
import { startPostgres } from '../../src/postgres/index.ts';
import type { ReactionsKit } from './support/reactions-kit.ts';
import { bootReactions, reactionsStart } from './support/reactions-kit.ts';

let postgres: RestartablePostgres | undefined;
let kit: ReactionsKit | undefined;
/**
 * True from `stopServer` to the `startServer` after it: `stop` of the container needs the server.
 */
let serverDown = false;
const lines: LoggedLine[] = [];

beforeAll(async () => {
  postgres = await startPostgres({ restartable: true });
  kit = await bootReactions({
    logger: recordingLogger(lines),
    external: {
      factory: postgresAdapter({
        ownerUrl: postgres.adminUrl,
        applicationName: 'reaction-restart',
      }),
      url: postgres.appUrl,
    },
  });
}, 180_000);

afterAll(async () => {
  if (serverDown) await postgres?.startServer();
  await kit?.stop();
  await postgres?.stop();
});

/**
 * Resolves once `condition` holds; with a grace of 60 s, and a look that started after it decides.
 */
async function until(label: string, condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const looked = Date.now();
    if (await condition()) return;
    if (looked > deadline) throw new Error(`${label} did not happen`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('the reaction dispatcher goes on after a restart of the server by itself: the signals sent before and after are each answered once by every reaction', {
  timeout: 240_000,
}, async () => {
  if (kit === undefined || postgres === undefined) throw new Error('the test did not start');
  const sent = async (channel: string): Promise<string> => {
    const outcome = await kit?.send('acme', { channel });
    if (outcome === undefined || !outcome.ok)
      throw new Error(`the signal of ${channel} was refused`);
    return outcome.value.signalId;
  };
  /** The reactions that answered the signal, one entry for each echo row. */
  const answers = async (signal: string): Promise<string[]> =>
    ((await kit?.rows('acme', 'relay.echo')) ?? [])
      .filter((row) => row.signal === signal)
      .map((row) => String(row.reaction))
      .sort();
  const everyReaction = [
    'relay.echo',
    'relay.flaky',
    'relay.latest',
    'relay.note',
    'relay.ordered',
    'relay.tally',
  ];
  const leaseFailures = (): number =>
    lines.filter((line) => line.message.startsWith('a consumer lease could not be reached')).length;

  const before = await sent('before');
  await kit.settle();
  expect(await answers(before)).toEqual(everyReaction);

  await postgres.stopServer();
  serverDown = true;
  const down = await kit.send('acme', { channel: 'down' });
  expect(down.ok).toBe(false);
  expect(down.ok === false && down.error.code).toBe('core.unavailable');
  // The clock moves while the server is away: the dispatcher's lease is asked for, and the call
  // fails.
  kit.pin(reactionsStart.add({ minutes: 1 }));
  await until('a failed lease call', async () => leaseFailures() >= 1);

  await postgres.startServer();
  serverDown = false;
  const after = await sent('after');
  // The pause of the failed lease call has passed on the clock. Nothing else drives the dispatcher
  // and the workers: the test calls no `settle`.
  kit.pin(reactionsStart.add({ minutes: 2 }));
  await until('the answers to the signal sent after the restart', async () => {
    return (await answers(after)).length >= everyReaction.length;
  });
  expect(await answers(after)).toEqual(everyReaction);
  // What ran before the restart did not run again.
  expect(await answers(before)).toEqual(everyReaction);
  // Each signal is answered once: a second answer that lands after the count reached six is found
  // when the kernel has settled.
  await kit.settle();
  expect(await answers(after)).toEqual(everyReaction);
  expect(await answers(before)).toEqual(everyReaction);
});
