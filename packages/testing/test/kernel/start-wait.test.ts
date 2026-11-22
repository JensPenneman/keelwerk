import { createServer } from 'node:net';
import { inspect } from 'node:util';
import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { DataAdapterFactory, Logger } from '@keelwerk/core';
import { errors, isKeelwerkError } from '@keelwerk/core';
import { fallbackReporter, memoryAdapter, schemaPlanner } from '@keelwerk/data';
import { afterEach, expect, test, vi } from 'vitest';
import { testSecrets } from '../../src/harness/test-secrets.ts';
import { boot, deploymentOf, refusal } from './support/runtime-kit.ts';

type Answer = 'ok' | 'unreachable' | 'refused-port' | 'refused' | (() => Promise<'unreachable'>);

/**
 * Memory adapters whose `connect` answers as the script says, one answer per call, per placement
 * id: the control placement is connected twice (the probe that reads the deployment id, then the
 * control adapter), the others once. A call after the script's end succeeds.
 */
function scripted(script: Record<string, Answer[]>): DataAdapterFactory {
  const inner = memoryAdapter();
  return {
    ...inner,
    create: (placement, environment) => {
      const adapter = inner.create(placement, environment);
      return {
        ...adapter,
        connect: async () => {
          const next = script[placement.id]?.shift() ?? 'ok';
          const answer = typeof next === 'function' ? await next() : next;
          if (answer === 'unreachable') throw errors.unavailable('the database is not reachable');
          if (answer === 'refused-port') {
            // The kind of error the driver gives for a port nobody listens on.
            const driver = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
              code: 'ECONNREFUSED',
            });
            throw errors.unavailable('the database is not reachable', { cause: driver });
          }
          if (answer === 'refused') throw errors.validation('the password was refused');
          return adapter.connect();
        },
      };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function recording() {
  const waits: Record<string, unknown>[] = [];
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    error: () => undefined,
    warn: (message, fields) => {
      if (message.startsWith('the database is not reachable')) waits.push({ ...fields });
    },
    child: () => log,
  };
  return { log, waits };
}

function deployment(factory: DataAdapterFactory) {
  return deploymentOf('memory', {
    infrastructure: [factory, schemaPlanner(), fallbackReporter(), testSecrets],
  });
}

test('a start waits for a database that is not reachable yet, in each of its three connects, and goes on when it answers', async () => {
  // The draw of the policy's jitter is the middle of its range, so each pause is its exact base.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { log, waits } = recording();
  let settled = false;
  const starting = boot(
    deployment(
      scripted({
        control: ['unreachable', 'unreachable', 'ok', 'unreachable', 'ok'],
        main: ['unreachable', 'ok'],
      }),
    ),
    { logger: log },
  ).finally(() => {
    settled = true;
  });
  // Ends with the script: it has four refusals, so four waits.
  while (!settled) await vi.advanceTimersByTimeAsync(1000);
  expect(await starting).toBeDefined();
  expect(waits.map((wait) => wait.placement)).toEqual(['control', 'control', 'control', 'main']);
  // An error with no code of its own still says so, so that every wait carries the field.
  expect(waits.map((wait) => wait.cause)).toEqual(['no code', 'no code', 'no code', 'no code']);
  // The first wait of a connect is the policy's base pause; a second failure of the same connect
  // waits twice as long; each connect counts its own failures.
  expect(waits.map((wait) => wait.waitMs)).toEqual([1000, 2000, 1000, 1000]);
}, 30_000);

test('the warning of a wait names the code of the driver behind the error, as a string', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { log, waits } = recording();
  let settled = false;
  const starting = boot(deployment(scripted({ main: ['refused-port', 'ok'] })), {
    logger: log,
  }).finally(() => {
    settled = true;
  });
  while (!settled) await vi.advanceTimersByTimeAsync(1000);
  await starting;
  expect(waits.map((wait) => wait.cause)).toEqual(['ECONNREFUSED']);
}, 30_000);

test('a connect that fails for a reason waiting cannot cure ends the start at once, with no wait', async () => {
  const { log, waits } = recording();
  const failure = await refusal(
    boot(deployment(scripted({ control: ['refused'] })), { logger: log }),
  );
  expect(failure.kind).toBe('validation');
  expect(waits).toEqual([]);
  const placement = await refusal(
    boot(deployment(scripted({ main: ['unreachable', 'refused'] })), { logger: log }),
  );
  expect(placement.kind).toBe('validation');
  expect(waits.map((wait) => wait.placement)).toEqual(['main']);
}, 30_000);

test('an abort of the signal during a wait ends the start, though the next attempt would have succeeded', async () => {
  const abort = new AbortController();
  const waiting = Promise.withResolvers<void>();
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    error: () => undefined,
    warn: (message) => {
      if (message.startsWith('the database is not reachable')) waiting.resolve();
    },
    child: () => log,
  };
  const starting = refusal(
    boot(deployment(scripted({ control: ['unreachable', 'ok', 'ok'] })), {
      logger: log,
      signal: abort.signal,
    }),
  );
  await waiting.promise;
  abort.abort();
  const failure = await starting;
  expect(isKeelwerkError(failure)).toBe(true);
  expect(failure.code).toBe('core.unavailable');
});

test('an abort of the signal during an attempt ends the start without another wait', async () => {
  const abort = new AbortController();
  const { log, waits } = recording();
  const attempt = Promise.withResolvers<'unreachable'>();
  const reached = Promise.withResolvers<void>();
  const slow = (): Promise<'unreachable'> => {
    reached.resolve();
    return attempt.promise;
  };
  const starting = refusal(
    boot(deployment(scripted({ control: [slow] })), { logger: log, signal: abort.signal }),
  );
  // The attempt is under way once the scripted connect has been called; only then does the signal
  // abort.
  await reached.promise;
  abort.abort();
  attempt.resolve('unreachable');
  const failure = await starting;
  expect(failure.code).toBe('core.unavailable');
  expect(waits).toEqual([]);
});

/** A local port that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

test('the wait on a port that refuses connections says the code of the cause, and nothing it logs holds the url, the user or the password', async () => {
  const password = `pw-${crypto.randomUUID()}`;
  const user = `user_${crypto.randomUUID().replaceAll('-', '_')}`;
  const url = `postgres://${user}:${password}@127.0.0.1:${await closedPort()}/refused`;
  const factory = postgresAdapter({ ownerUrl: url, applicationName: 'start-wait-refused' });
  const logged: { level: string; message: string; fields: unknown }[] = [];
  const waiting = Promise.withResolvers<void>();
  const recorder =
    (level: string): Logger['warn'] =>
    (message, fields) => {
      logged.push({ level, message, fields });
      if (message.startsWith('the database is not reachable')) waiting.resolve();
    };
  const log: Logger = {
    debug: recorder('debug'),
    info: recorder('info'),
    warn: recorder('warn'),
    error: recorder('error'),
    child: () => log,
  };
  const abort = new AbortController();
  const starting = refusal(
    boot(
      deploymentOf('memory', {
        infrastructure: [factory, schemaPlanner(), fallbackReporter(), testSecrets],
        control: { adapter: factory.id, url },
        placements: { main: { adapter: factory.id, strategy: 'shared-tables', url } },
      }),
      { logger: log, signal: abort.signal },
    ),
  );
  await waiting.promise;
  abort.abort();
  expect((await starting).code).toBe('core.unavailable');
  const waits = logged.filter((line) => line.message.startsWith('the database is not reachable'));
  expect(waits[0]?.fields).toMatchObject({ placement: 'control', cause: 'ECONNREFUSED' });
  // Everything the start logged, with the errors it holds and what they hold, in full.
  const everything = inspect(logged, { depth: null, showHidden: true });
  for (const secret of [password, user, url, 'postgres://']) {
    expect(everything).not.toContain(secret);
  }
}, 30_000);
