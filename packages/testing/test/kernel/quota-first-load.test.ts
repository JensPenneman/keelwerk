import type { DataAdapter, DataAdapterFactory } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { useEpochDirectories } from './support/epoch-directories.ts';
import { bootHooks } from './support/hooks-kit.ts';
import { effectOf } from './support/hooks-reads.ts';
import { jobSpy } from './support/job-spy.ts';

// What a process does with the limits at its start: it loads them before the restore check
// enqueues, waits for a database that is away by the policy of the background loops, and ends the
// start on an error that waiting cannot cure. What decides each case: the job the restore enqueued,
// and the number of reads of the quota rows, counted where the store is read; the waits run on
// faked timers and nothing else is timed.

const directories = useEpochDirectories();
const { durableFactory, backUp, restore } = directories;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a restore enqueues with the limits set before the process started', () => {
  test('the effect job the restore enqueues again takes the cap and weight of its tenant', {
    timeout: 180_000,
  }, async () => {
    const limits = { 'queue:posts.running': '7', 'queue:posts.weight': '3' };
    const bootEffects = (
      over: Omit<Parameters<typeof bootHooks>[0], 'endpoint' | 'serveOnly' | 'quotas'>,
    ) => bootHooks({ endpoint: 'http://127.0.0.1:1/', serveOnly: true, quotas: limits, ...over });
    const first = await bootEffects({
      adapter: 'pglite',
      external: { factory: durableFactory(), url: 'pglite' },
    });
    directories.track(() => first.runtime.stop(1000));
    const ids = {
      backendId: first.runtime.backendId,
      tenants: { acme: first.runtime.tenants.acme.id },
    };
    await first.client.invoke('hooks.notify', { payload: 'one' });
    const effect = await effectOf(first, 'hooks.post');
    expect(effect).toMatchObject({ status: 'requested' });
    // The queue loses the job while the row stays requested, as a backup of a lagging queue does.
    expect(await first.raw((unit) => unit.jobs.cancel('posts', String(effect?.id)))).toBe(1);
    await first.runtime.stop(1000);
    directories.release();
    await backUp();
    const second = await bootEffects({
      adapter: 'pglite',
      external: { factory: durableFactory(), url: 'pglite' },
      join: ids,
    });
    directories.track(() => second.runtime.stop(1000));
    await second.client.invoke('hooks.notify', { payload: 'two' });
    await second.runtime.stop(1000);
    directories.release();
    await restore();

    const { spy, factory } = jobSpy(() => undefined, durableFactory());
    const third = await bootEffects({
      adapter: 'pglite',
      external: { factory, url: 'pglite' },
      join: ids,
    });
    directories.track(() => third.runtime.stop(1000));
    const again = spy.enqueued.filter(
      (entry) => 'effect' in entry.job.run && entry.job.run.effect === effect?.id,
    );
    expect(again).toHaveLength(1);
    expect(again[0]?.job).toMatchObject({ queue: 'posts', laneCap: 7, laneWeight: 3 });
    // The framework accepted the effect before: its job is counted, never refused.
    expect('queuedCap' in (again[0]?.job ?? {})).toBe(false);
  });
});

const descriptorOf = (ref: string) => conformanceApp.registry.entities.get(ref)?.descriptor;

/** The in-memory adapter whose reads of the `core.quota` rows are counted and may be made to fail. */
function countingQuotaReads() {
  const reads = { count: 0, failure: undefined as Error | undefined };
  const arrivals: { readonly at: number; readonly resolve: () => void }[] = [];
  const base = memoryAdapter({ entities: descriptorOf });
  const factory: DataAdapterFactory = {
    ...base,
    create: (placement, env): DataAdapter => {
      const adapter = base.create(placement, env);
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
                    if (descriptor.ref === 'core.quota') {
                      reads.count += 1;
                      for (const arrival of arrivals)
                        if (arrival.at === reads.count) arrival.resolve();
                      if (reads.failure !== undefined) throw reads.failure;
                    }
                    return unit.rows.find(descriptor, query);
                  },
                },
              }),
            options,
          ),
      };
    },
  };
  return {
    factory,
    reads,
    /** Settles when the store has been asked for the quota rows `at` times. */
    arrived: (at: number): Promise<void> =>
      reads.count >= at
        ? Promise.resolve()
        : new Promise((resolve) => {
            arrivals.push({ at, resolve });
          }),
  };
}

describe('the start loads the limits first', () => {
  test('a database that is away delays the start by the policy of the background loops', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = countingQuotaReads();
    store.reads.failure = errors.unavailable('The control store is away.');
    let started = false;
    const starting = startTestRuntime(conformanceApp, {
      tenants: ['acme'],
      external: { factory: store.factory, url: 'memory://first-load' },
    }).then((runtime) => {
      started = true;
      return runtime;
    });
    await store.arrived(1);
    // The first pause is one second: the start does not read again before it has passed.
    await vi.advanceTimersByTimeAsync(999);
    expect(store.reads.count).toBe(1);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await store.arrived(2);
    // The second pause is two seconds.
    await vi.advanceTimersByTimeAsync(1999);
    expect(store.reads.count).toBe(2);
    store.reads.failure = undefined;
    await vi.advanceTimersByTimeAsync(1);
    const runtime = await starting;
    expect(started).toBe(true);
    expect(store.reads.count).toBeGreaterThanOrEqual(3);
    await runtime.stop();
  });

  test('an error that waiting cannot cure ends the start', async () => {
    const store = countingQuotaReads();
    store.reads.failure = errors.internal('The quota rows cannot be read.');
    await expect(
      startTestRuntime(conformanceApp, {
        tenants: ['acme'],
        external: { factory: store.factory, url: 'memory://first-load-ends' },
      }),
    ).rejects.toMatchObject({ kind: 'internal' });
    expect(store.reads.count).toBe(1);
  });
});
