import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import type { RestartablePostgres } from '../../src/postgres/index.ts';
import { startPostgres } from '../../src/postgres/index.ts';
import { startStartingUpRelay } from '../support/starting-up-relay.ts';
import { bootTicker } from './support/ticker-kit.ts';

let postgres: RestartablePostgres | undefined;

beforeAll(async () => {
  postgres = await startPostgres({ restartable: true });
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
});

const waits = (lines: readonly LoggedLine[]): LoggedLine[] =>
  lines.filter((line) => line.message.startsWith('the database is not reachable'));

function database(): RestartablePostgres {
  if (postgres === undefined) throw new Error('the container did not start');
  return postgres;
}

/**
 * Starts the ticker app on the container's database as the application role, with the url's changes
 * applied; the signal ends a start that waits.
 */
function start(
  lines: LoggedLine[],
  signal: AbortSignal,
  change: (url: URL) => void = () => undefined,
) {
  const url = new URL(database().appUrl);
  change(url);
  return bootTicker({
    workers: false,
    logger: recordingLogger(lines),
    signal,
    external: {
      factory: postgresAdapter({ ownerUrl: database().adminUrl, applicationName: 'start-wait' }),
      url: url.toString(),
    },
  });
}

describe('a start while the database is not reachable', () => {
  test('waits, and goes on when the server answers: a command commits', {
    timeout: 120_000,
  }, async () => {
    const lines: LoggedLine[] = [];
    await database().stopServer();
    let down = true;
    const abort = new AbortController();
    // Through a relay that answers the first connection as a server that is starting up (57P03);
    // the server behind it is stopped, so the second connection is lost.
    const relay = await startStartingUpRelay(database().appUrl);
    const through = new URL(relay.url);
    const starting = start(lines, abort.signal, (url) => {
      url.hostname = through.hostname;
      url.port = through.port;
    });
    // A start that ends while the server is down is a failure of its own, and ends each look.
    const early = starting.then(() => {
      throw new Error('the start ended while the server was down');
    });
    early.catch(() => undefined);
    try {
      // The start has said twice that it waits: once for the answer of 57P03, once for the lost
      // connection. The loop ends with that, with the start ending early, or with the grace below,
      // so the server is started again (`finally`) before the file's teardown; a look that began
      // after the grace decides.
      const deadline = Date.now() + 60_000;
      while (waits(lines).length < 2) {
        const looked = Date.now();
        await Promise.race([early, new Promise((resolve) => setTimeout(resolve, 20))]);
        if (waits(lines).length < 2 && looked > deadline) {
          throw new Error('the start did not say twice that it waits');
        }
      }
      await database().startServer();
      down = false;
      const kit = await starting;
      try {
        expect((await kit.call('acme', 'ticker.armTimer', { at: 'one' })).ok).toBe(true);
      } finally {
        await kit.stop();
      }
    } finally {
      // A start that is still waiting (the case failed at its grace) ends through its signal and
      // settles before the relay and the file go; one that has connected is not touched by it.
      abort.abort();
      await starting.then(
        () => undefined,
        () => undefined,
      );
      await relay.close();
      // A failed case must not leave the server down for the cases after it.
      if (down) await database().startServer();
    }
    expect(waits(lines)[0]?.fields).toMatchObject({ placement: 'control', cause: '57P03' });
    expect(waits(lines)[1]?.fields).toMatchObject({ placement: 'control' });
  });

  test('ends at once on a password the server refuses, with no wait', {
    timeout: 120_000,
  }, async () => {
    const lines: LoggedLine[] = [];
    const failure = await start(lines, new AbortController().signal, (url) => {
      url.password = 'not-the-password';
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: '28P01' });
    expect(waits(lines)).toEqual([]);
  });

  test('ends at once on a database that does not exist, with no wait', {
    timeout: 120_000,
  }, async () => {
    const lines: LoggedLine[] = [];
    const failure = await start(lines, new AbortController().signal, (url) => {
      url.pathname = '/there_is_no_such_database';
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: '3D000' });
    expect(waits(lines)).toEqual([]);
  });
});
