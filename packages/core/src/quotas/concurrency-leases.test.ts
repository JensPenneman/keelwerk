import { describe, expect, test } from 'vitest';
import type { ControlLease } from '../control/control-lease.ts';
import type { ControlLeaseStore } from '../control/control-lease-store.ts';
import { errors } from '../errors/errors.ts';
import type { ConcurrencyKind } from './concurrency-leases.ts';
import { createConcurrencyLeases } from './concurrency-leases.ts';

// The counter of one process against a store of leases that the test owns: two processes (A and B)
// share one store and one clock that the test moves by hand. A write is one unit of the runner; the
// runner counts them and can hold the next one at a barrier. Nothing here waits for time.

const scopeId = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

function sharedStore() {
  const clock = { now: 0 };
  const rows = new Map<string, ControlLease & { expires: number }>();
  const idOf = (kind: string, key: string, holder: string) => `${kind}|${key}|${holder}`;
  const totalOf = (kind: string, key: string): number =>
    [...rows.values()]
      .filter((row) => row.kind === kind && row.key === key && row.expires > clock.now)
      .reduce((sum, row) => sum + row.units, 0);
  const leases: ControlLeaseStore = {
    hold: async (lease, ttlMs) => {
      rows.set(idOf(lease.kind, lease.key, lease.holder), {
        ...lease,
        expiresAt: Temporal.Instant.fromEpochMilliseconds(0),
        expires: clock.now + ttlMs,
      });
      return { total: totalOf(lease.kind, lease.key) };
    },
    renew: async (holder, wanted, ttlMs) =>
      wanted.filter((lease) => {
        const row = rows.get(idOf(lease.kind, lease.key, holder));
        if (row === undefined || row.expires <= clock.now) return true;
        row.expires = clock.now + ttlMs;
        return false;
      }),
    release: async (kind, key, holder) => {
      rows.delete(idOf(kind, key, holder));
    },
    total: async (kind, key) => totalOf(kind, key),
    expire: async (kind) => {
      for (const [id, row] of rows) {
        if (row.kind === kind && row.expires <= clock.now) rows.delete(id);
      }
      return [];
    },
  };
  return { clock, rows, leases, totalOf };
}

/** One process: its counter over the shared store, with the writes it made and a barrier for the next one. */
function member(store: ReturnType<typeof sharedStore>, holder: string) {
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
      return fn(store.leases);
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

const refused = {
  kind: 'rate_limited',
  code: 'core.concurrency_limited',
  retryAfter: 1,
  details: { dimension: 'core.liveSubscriptions', limit: 2 },
};

describe('the limit across processes', () => {
  test('a take past the limit of the deployment is refused, and is admitted again once the holder has lowered its lease', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first, second] = await Promise.all([a.ask(2), a.ask(2)]);
    await expect(b.ask(2)).rejects.toMatchObject(refused);
    first();
    // The slot ended in A, whose lease still holds both units until its next pass.
    await expect(b.ask(2)).rejects.toMatchObject(refused);
    await a.counter.pass();
    await expect(b.ask(2)).resolves.toBeTypeOf('function');
    // Another tenant is not counted with this one.
    await expect(b.ask(2, 'subscriptions', other)).resolves.toBeTypeOf('function');
    second();
  });

  test('a slot that ended is taken again without a write', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const one = await a.ask(5);
    expect(a.state.writes).toBe(1);
    one();
    await a.ask(5);
    expect(a.state.writes).toBe(1);
  });

  test('takes that wait for a write share the next one', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const open = a.hold();
    const takes = [a.ask(10), a.ask(10), a.ask(10)];
    expect(a.state.writes).toBe(1);
    open();
    await Promise.all(takes);
    expect(a.state.writes).toBe(2);
    expect(store.totalOf('subscriptions', scopeId)).toBe(3);
  });

  test('a write past the limit holds only what fits, so the total of the store never stands above it', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    await a.ask(2);
    const answers = await Promise.allSettled([b.ask(2), b.ask(2), b.ask(2)]);
    expect(answers.map((answer) => answer.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
  });

  test('a holder whose row was swept holds it again at its next pass', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    await a.ask(1);
    store.clock.now += 31_000;
    await b.counter.pass();
    expect(store.rows.size).toBe(0);
    await a.counter.pass();
    await expect(b.ask(1)).rejects.toMatchObject({
      ...refused,
      details: { dimension: 'core.liveSubscriptions', limit: 1 },
    });
  });

  test('a pass renews what is held, so a holder that keeps passing is never swept', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    await a.ask(1);
    for (let round = 0; round < 4; round += 1) {
      store.clock.now += 10_000;
      await a.counter.pass();
      await b.counter.pass();
    }
    expect(store.totalOf('subscriptions', scopeId)).toBe(1);
  });

  test('the sweep of a pass leaves no row of a holder that stopped, in any of the three kinds', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    await a.ask(5, 'subscriptions');
    await a.ask(5, 'connections');
    await a.ask(5, 'invocations');
    expect(store.rows.size).toBe(3);
    store.clock.now += 31_000;
    await b.ask(5, 'invocations', other);
    await b.counter.pass();
    expect([...store.rows.values()].map((row) => row.holder)).toEqual(['B']);
  });
});

describe('a lowered limit', () => {
  const at = (limit: number) => ({ ...refused, details: { ...refused.details, limit } });

  test('closes nothing: a take within the held slots is admitted until the pass, a further take is refused after it, one is admitted again once enough has ended, and the other scope is not touched', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    // A slot of another scope is held by A through the case, and B takes one there too: neither is touched below.
    await a.ask(5, 'subscriptions', other);
    const [first, second, third] = await Promise.all([a.ask(3), a.ask(3), a.ask(3)]);
    first();
    second();
    // The slots that ended are still held (3 units) with one in use; the limit is now 1.
    await expect(b.ask(1)).rejects.toMatchObject(at(1));
    const writes = a.state.writes;
    const within = await a.ask(1);
    expect(a.state.writes).toBe(writes);
    expect(store.totalOf('subscriptions', scopeId)).toBe(3);
    await expect(b.ask(5, 'subscriptions', other)).resolves.toBeTypeOf('function');
    // The pass gives back what is not in use, down to the two slots that are: nothing is closed.
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    expect(store.totalOf('subscriptions', other)).toBe(2);
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
    await expect(b.ask(1)).rejects.toMatchObject(at(1));
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    // One ends: the count is at the limit, still refused. The other ends: a take is admitted again.
    third();
    await a.counter.pass();
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
    within();
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(0);
    await expect(a.ask(1)).resolves.toBeTypeOf('function');
    expect(store.totalOf('subscriptions', other)).toBe(2);
  });

  test('is not met by a lease that lapsed and is held again: it is held at what is in use, over the limit, and nothing is closed', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first, second] = await Promise.all([a.ask(2), a.ask(2)]);
    store.clock.now += 31_000;
    await b.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(0);
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    await expect(b.ask(1)).rejects.toMatchObject(at(1));
    first();
    await a.counter.pass();
    await expect(b.ask(1)).rejects.toMatchObject(at(1));
    second();
    await a.counter.pass();
    await expect(b.ask(1)).resolves.toBeTypeOf('function');
  });
});

describe('a store that fails', () => {
  test('a take that needs a write is refused with the error of the store, one within the held units is admitted', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const [first] = await Promise.all([a.ask(5), a.ask(5)]);
    first();
    a.state.failure = errors.unavailable('The control store is away.');
    await expect(a.ask(5)).resolves.toBeTypeOf('function');
    await expect(a.ask(5)).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
  });

  test('a take that arrives while a write with no take of its own fails is refused with the error of the store', async () => {
    // Take the refusal of `pair.waiting` out of the catch of `settle`: the take stays pending for good.
    const store = sharedStore();
    const a = member(store, 'A');
    const [first] = await Promise.all([a.ask(5), a.ask(5)]);
    first();
    // The pair holds two units and uses one: the pass writes the lowering, with no take to answer.
    const open = a.hold();
    const passing = a.counter.pass();
    let outcome = 'pending';
    void a.ask(5).then(
      () => {
        outcome = 'admitted';
      },
      (failure: { code: string }) => {
        outcome = failure.code;
      },
    );
    a.state.failure = errors.unavailable('The control store is away.');
    open();
    await expect(passing).rejects.toMatchObject({ code: 'core.unavailable' });
    // The refusal is sent before the pass fails, so the take has answered by now.
    expect(outcome).toBe('core.unavailable');
  });
});
