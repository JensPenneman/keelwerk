import { type DataAdapterFactory, errors, type Logger } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { afterEach, expect, test, vi } from 'vitest';
import { bootFlags, flagsApp } from './support/flags-kit.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const row = (targeting: unknown) => ({
  id: 'flg-1',
  key: 'gates.live',
  backendId: null,
  version: 1,
  targeting,
});
const closed = row({ enabled: true, rules: [], fallthrough: { value: false } });
const unreadable = row({ enabled: 'yes', rules: [], fallthrough: { value: false } });

interface Store {
  /** The count of reads of the `core.flag` rows. */
  reads: number;
  /** What every read of them throws; none: the store answers with `stored`. */
  failure?: Error | undefined;
  stored: ReturnType<typeof row>;
}

/** Memory adapters whose read of the `core.flag` rows throws `failure` while one is set, else answers with the one stored row. */
function flagStore(store: Store): DataAdapterFactory {
  const inner = memoryAdapter({
    entities: (ref) => flagsApp.registry.entities.get(ref)?.descriptor,
  });
  return {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      return {
        ...adapter,
        unit: (namespace, scope, fn, options) =>
          adapter.unit(
            namespace,
            scope,
            (unit) =>
              fn({
                ...unit,
                rows: {
                  ...unit.rows,
                  find: async (descriptor, query) => {
                    if (descriptor.ref !== 'core.flag') return unit.rows.find(descriptor, query);
                    store.reads += 1;
                    if (store.failure !== undefined) throw store.failure;
                    return {
                      rows: [store.stored],
                      pageInfo: {
                        hasNextPage: false,
                        hasPreviousPage: false,
                        startCursor: null,
                        endCursor: null,
                      },
                    };
                  },
                },
              }),
            options,
          ),
      };
    },
  };
}

const boot = (store: Store, logger?: Logger) =>
  bootFlags(flagsApp, {
    external: { factory: flagStore(store), url: 'memory://flags' },
    ...(logger === undefined ? {} : { logger }),
  });

test('a start waits for the first read of the flag rows, before its start phase, so a kill switch closed in the store never reads open', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const phases: unknown[] = [];
  const log: Logger = {
    debug: (message, fields) => {
      if (message === 'phase') phases.push(fields?.phase);
    },
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => log,
  };
  const store: Store = {
    reads: 0,
    failure: errors.unavailable('the store is away'),
    stored: closed,
  };
  let settled = false;
  const starting = boot(store, log).finally(() => {
    settled = true;
  });
  // On until the store has refused two reads, or the start has gone on without waiting: no count of rounds.
  while (!settled && store.reads < 2) await vi.advanceTimersByTimeAsync(1000);
  expect(store.reads).toBeGreaterThanOrEqual(2);
  expect(settled).toBe(false);
  expect(phases).not.toContain('start');
  store.failure = undefined;
  while (!settled) await vi.advanceTimersByTimeAsync(1000);
  const { call } = await starting;
  expect(await call('gates.suspendable', {})).toMatchObject({
    ok: false,
    error: { kind: 'unavailable', code: 'core.feature_suspended' },
  });
}, 30_000);

test('a first read of the flag rows that fails with another error than unavailability ends the start', async () => {
  const store: Store = { reads: 0, failure: errors.internal('boom'), stored: closed };
  await expect(boot(store)).rejects.toMatchObject({ code: 'core.internal' });
});

test('a boolean kill switch whose stored row cannot be read as declared refuses its action', async () => {
  const { call } = await boot({ reads: 0, stored: unreadable });
  expect(await call('gates.suspendable', {})).toMatchObject({
    ok: false,
    error: { kind: 'unavailable', code: 'core.feature_suspended' },
  });
}, 30_000);
