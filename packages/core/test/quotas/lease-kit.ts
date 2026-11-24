import type { ControlLease } from '../../src/control/control-lease.ts';
import type { ControlLeaseStore } from '../../src/control/control-lease-store.ts';
import type { ConcurrencyLeases } from '../../src/quotas/concurrency-leases.ts';
import { createConcurrencyLeases } from '../../src/quotas/concurrency-leases.ts';

type ConcurrencyKind = Parameters<ConcurrencyLeases['take']>[0]['kind'];

type Row = ControlLease & { expires: number };

// The counter of one process against a store of leases that the test owns: two processes (A and B)
// share one store and one clock that the test moves by hand. A write is one unit of the runner; the
// runner counts them and can hold the next one at a barrier. Nothing here waits for time.

export const scopeId = '11111111-1111-4111-8111-111111111111';
export const other = '22222222-2222-4222-8222-222222222222';

/**
 * The leases of the test: one set of rows and one clock that the test moves by hand. Each process
 * reads and writes them on its own clock, the shared one plus its offset. A renew reads the other
 * holders first and writes after, as the statement of the store does, and can be stalled between.
 */
export function sharedStore() {
  const clock = { now: 0 };
  const rows = new Map<string, Row>();
  const renewals: number[] = [];
  const holds: number[] = [];
  let gate: Promise<void> | undefined;
  let reached: (() => void) | undefined;
  let holdGate:
    | { readonly holder: string; readonly passed: Promise<void>; reached: () => void }
    | undefined;
  const idOf = (kind: string, key: string, holder: string) => `${kind}|${key}|${holder}`;
  const totalOf = (kind: string, key: string, offset = 0): number =>
    [...rows.values()]
      .filter((row) => row.kind === kind && row.key === key && row.expires > clock.now + offset)
      .reduce((sum, row) => sum + row.units, 0);
  const viewOf = (offset: number): ControlLeaseStore => ({
    hold: async (lease, ttlMs) => {
      if (!Number.isInteger(lease.units) || lease.units < 1)
        throw new Error('a hold of fewer than 1 unit');
      if (holdGate !== undefined && holdGate.holder === lease.holder) {
        holdGate.reached();
        await holdGate.passed;
      }
      holds.push(lease.units);
      rows.set(idOf(lease.kind, lease.key, lease.holder), {
        ...lease,
        expiresAt: Temporal.Instant.fromEpochMilliseconds(0),
        expires: clock.now + offset + ttlMs,
      });
      return { total: totalOf(lease.kind, lease.key, offset) };
    },
    renew: async (holder, wanted, ttlMs) => {
      if (wanted.length > 1_000) throw new Error('a renew of more than 1,000 pairs');
      renewals.push(wanted.length);
      const answers = wanted.map((lease) => {
        const own = rows.get(idOf(lease.kind, lease.key, holder));
        const others =
          totalOf(lease.kind, lease.key, offset) -
          (own && own.expires > clock.now + offset ? own.units : 0);
        return {
          total: lease.units + others,
          lapsed: own === undefined || own.expires <= clock.now + offset,
        };
      });
      if (gate !== undefined) {
        reached?.();
        await gate;
      }
      for (const lease of wanted) {
        const id = idOf(lease.kind, lease.key, holder);
        if (lease.units === 0) rows.delete(id);
        else {
          rows.set(id, {
            ...lease,
            holder,
            expiresAt: Temporal.Instant.fromEpochMilliseconds(0),
            expires: clock.now + offset + ttlMs,
          });
        }
      }
      return answers;
    },
    release: async (kind, key, holder) => {
      rows.delete(idOf(kind, key, holder));
    },
    total: async (kind, key) => totalOf(kind, key, offset),
    expire: async (kind) => {
      for (const [id, row] of rows) {
        if (row.kind === kind && row.expires <= clock.now + offset) rows.delete(id);
      }
      return [];
    },
  });
  /** Holds the next renews between their read and their write; answers a promise for the first to get there. */
  const stall = () => {
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let open!: () => void;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    return {
      arrived,
      release: () => {
        gate = undefined;
        open();
      },
    };
  };
  /**
   * Holds every later `hold` of a holder before it writes, as a store that went away and stays
   * away does: it answers a promise for the first to get there, then lets them all go on
   * (`release`) or fail with one error (`fail`).
   */
  const stallHold = (holder: string) => {
    let reachedHold!: () => void;
    const arrived = new Promise<void>((resolve) => {
      reachedHold = resolve;
    });
    let release!: () => void;
    let fail!: (error: unknown) => void;
    const passed = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    holdGate = { holder, passed, reached: reachedHold };
    return { arrived, release, fail };
  };
  return { clock, rows, renewals, holds, viewOf, totalOf, stall, stallHold };
}

/** One process: its counter over the shared store, with the writes it made and a barrier for the next one. */
export function member(store: ReturnType<typeof sharedStore>, holder: string, offset = 0) {
  const state = {
    writes: 0,
    barrier: undefined as Promise<void> | undefined,
    failure: undefined as unknown,
  };
  const counter = createConcurrencyLeases({
    holder,
    run: async (fn) => {
      state.writes += 1;
      await state.barrier;
      if (state.failure !== undefined) throw state.failure;
      return fn(store.viewOf(offset));
    },
  });
  const ask = (limit: number, kind: ConcurrencyKind = 'subscriptions', id = scopeId) =>
    counter.take({ kind, scopeId: id, dimension: 'core.liveSubscriptions', limit });
  const hold = (): (() => void) => {
    let open!: () => void;
    state.barrier = new Promise<void>((resolve) => {
      open = resolve;
    });
    return () => {
      state.barrier = undefined;
      open();
    };
  };
  return { counter, ask, state, hold };
}

export const refused = {
  kind: 'rate_limited',
  code: 'core.concurrency_limited',
  retryAfter: 1,
  details: { dimension: 'core.liveSubscriptions', limit: 2 },
};
export const at = (limit: number) => ({ ...refused, details: { ...refused.details, limit } });
