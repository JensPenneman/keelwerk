import type { PurgeBatch, RuntimeServiceContext } from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';
import { vi } from 'vitest';

const never = (): void => undefined;

/** What a test may change in the fake control store. */
export interface FakeRetentionOptions {
  /** The answer of every `purgeTransient` of the control scope (default: nothing to purge). */
  readonly transient?: () => PurgeBatch;
  /** The answers of the lease of the worker; both default to holding it. */
  readonly lease?: { readonly acquire?: () => boolean; readonly renew?: () => boolean };
  /** Runs after each `purgeTransient`, with the number of calls so far. */
  readonly afterTransient?: (calls: number) => void;
}

/**
 * A context over a fake control store whose one unit counts its calls: `hold` makes the first unit
 * the worker opens to purge wait until released, `reached()` tells whether a namespace was looked
 * at, `at` is the instant of the runtime clock. The lease of the worker is a namespace-scope unit
 * of the control store: `acquired` and `renewed` count its calls and `opened` does not count it.
 */
export function fakeRetentionContext(
  signal: AbortSignal,
  at = '2026-11-18T12:00:00Z',
  hold = false,
  options: FakeRetentionOptions = {},
) {
  let reached = false;
  let now = Temporal.Instant.from(at);
  const clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const release = Promise.withResolvers<void>();
  const purged = vi.fn(async () => {
    if (hold) await release.promise;
  });
  const transientCalls = vi.fn();
  const historyCalls = vi.fn();
  const acquired = vi.fn(() => options.lease?.acquire?.() ?? true);
  const renewed = vi.fn(async (_consumer: string, _owner: string, _ttlMs: number) =>
    options.lease?.renew === undefined ? true : options.lease.renew(),
  );
  const unit = {
    events: {
      purgeTransient: async (): Promise<PurgeBatch> => {
        transientCalls();
        const answer = options.transient?.() ?? { removed: 0, more: false };
        options.afterTransient?.(transientCalls.mock.calls.length);
        return answer;
      },
    },
    jobs: {
      purgeHistory: async () => {
        historyCalls();
        return { removed: 0, more: false };
      },
    },
    rows: { find: async () => ({ rows: [] }), purge: async () => 0 },
    streams: { expire: async () => 0 },
    keys: { destroyValueKey: async () => undefined },
    consumers: {
      acquireLease: async (_consumer: string, _owner: string, _ttlMs: number) => acquired(),
      renewLease: renewed,
    },
  };
  const opened = vi.fn(
    async (_namespace: unknown, _scope: unknown, fn: (u: unknown) => unknown) => {
      await purged();
      return fn(unit);
    },
  );
  // The lease is a namespace-scope unit: it is no purge and is not counted as one.
  const route = (namespace: unknown, scope: { level: string }, fn: (u: unknown) => unknown) =>
    scope.level === 'namespace' ? fn(unit) : opened(namespace, scope, fn);
  const infos: string[] = [];
  const context = {
    signal,
    clock,
    timers,
    log: {
      debug: never,
      info: (message: string) => {
        infos.push(message);
      },
      warn: never,
      error: never,
    },
    control: {
      deploymentId: 'd-1',
      namespace: { id: 'ns-control' },
      registry: { entities: new Map(), streams: new Map() },
      adapter: { unit: route },
    },
    get namespaces() {
      reached = true;
      return [];
    },
  } as unknown as RuntimeServiceContext;
  return {
    context,
    opened,
    purged,
    timers,
    acquired,
    renewed,
    transientCalls,
    historyCalls,
    infos,
    release: release.resolve,
    reached: () => reached,
    /** Moves the runtime clock to an instant without firing a timer. */
    setNow: (instant: string): void => {
      now = Temporal.Instant.from(instant);
    },
    /** Moves the runtime clock and lets the timers whose instant came fire. */
    advance: async (milliseconds: number) => {
      now = now.add({ milliseconds });
      return timers.fire();
    },
  };
}
