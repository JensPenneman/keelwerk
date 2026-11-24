import { describe, expect, test } from 'vitest';
import { at, member, scopeId, sharedStore } from './lease-kit.ts';

describe('the pass', () => {
  test('is a renew in parts of at most 1,000 pairs and one sweep, whatever has changed: pairs lowered, at zero and held anew', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const ids = Array.from({ length: 2_500 }, (_, index) => `pair-${index}`);
    const slots = new Map<string, (() => void)[]>();
    for (const id of ids) {
      slots.set(id, [await a.ask(9, 'subscriptions', id), await a.ask(9, 'subscriptions', id)]);
    }
    for (const id of ids.slice(0, 1_000)) for (const release of slots.get(id) ?? []) release();
    for (const id of ids.slice(1_000, 2_000)) slots.get(id)?.[0]?.();
    // The leases of the last 500 were swept.
    for (const id of ids.slice(2_000)) store.rows.delete(`subscriptions|${id}|A`);
    const writes = a.state.writes;
    store.renewals.length = 0;
    await a.counter.pass();
    expect(store.renewals).toEqual([1_000, 1_000, 500]);
    expect(a.state.writes - writes).toBe(4);
    expect(store.rows.size).toBe(1_500);
    expect(store.totalOf('subscriptions', 'pair-0')).toBe(0);
    expect(store.totalOf('subscriptions', 'pair-1500')).toBe(1);
    expect(store.totalOf('subscriptions', 'pair-2400')).toBe(2);
  });

  test('a pair with nothing in use and nothing held is forgotten, and a take after it writes again', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    (await a.ask(5))();
    await a.counter.pass();
    expect(store.rows.size).toBe(0);
    const writes = a.state.writes;
    await a.ask(5);
    expect(a.state.writes).toBe(writes + 1);
  });

  test('a pair forgotten and taken again while the pass renews an earlier part is not renewed at the units of the old one', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const probed = 'probed';
    const fill = Array.from({ length: 1_000 }, (_, index) => `pair-${index}`);
    for (const id of fill) await a.ask(9, 'subscriptions', id);
    await b.ask(1, 'subscriptions', probed);
    // The take of A on the probed pair waits at the barrier, so the pair is listed by the pass that starts now.
    const open = a.hold();
    const refusal = expect(a.ask(1, 'subscriptions', probed)).rejects.toMatchObject(at(1));
    const stalled = store.stall();
    const passing = a.counter.pass();
    open();
    await Promise.all([refusal, stalled.arrived]);
    // The refusal forgot the pair while the first part is renewed; a take makes it again.
    await a.ask(9, 'subscriptions', probed);
    stalled.release();
    await passing;
    expect(store.totalOf('subscriptions', probed)).toBe(2);
  });

  test('a forgotten pair is not listed in the next pass', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    (await a.ask(5))();
    await a.counter.pass();
    await a.counter.pass();
    expect(store.renewals).toEqual([1]);
  });

  test('a pair with a write in flight is left to that write: the renew does not list it', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const open = a.hold();
    const taking = a.ask(5);
    const passing = a.counter.pass();
    open();
    await Promise.all([taking, passing]);
    expect(store.renewals).toEqual([]);
    expect(store.totalOf('subscriptions', scopeId)).toBe(1);
  });

  test('sets the lease to the units in use when the part starts: a slot that ends while the renew waits does not lower what the next reuse relies on', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first] = await Promise.all([a.ask(2), a.ask(2)]);
    // The renew of the pass waits at the barrier; a slot ends meanwhile.
    const open = a.hold();
    const passing = a.counter.pass();
    first();
    open();
    await passing;
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    // A reuses the unit it holds, with no write: the store must already count it.
    const writes = a.state.writes;
    await a.ask(2);
    expect(a.state.writes).toBe(writes);
    await expect(b.ask(2)).rejects.toMatchObject(at(2));
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
  });

  test('holds the units in use after it: a unit that ended before the pass is not reused without a write that counts it', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first] = await Promise.all([a.ask(2), a.ask(2)]);
    first();
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(1);
    // The one unit held is in use: the next take is a write, which holds both, and B is refused.
    const writes = a.state.writes;
    await a.ask(2);
    expect(a.state.writes).toBe(writes + 1);
    await expect(b.ask(2)).rejects.toMatchObject(at(2));
  });
});

describe('a write', () => {
  test('in which every take fits makes one hold', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    // The first take writes alone; the two that arrive meanwhile share the next write.
    await Promise.all([a.ask(5), a.ask(5), a.ask(5)]);
    expect(store.holds).toEqual([1, 3]);
  });

  test('in which no take fits releases the lease and holds nothing', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    await b.ask(1);
    store.holds.length = 0;
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
    expect(store.holds).toEqual([1]);
    expect(store.rows.has(`subscriptions|${scopeId}|A`)).toBe(false);
  });
});

describe('the life of a lease read on a clock that runs ahead', () => {
  test.each([
    { skew: 0, pass: 19, counted: true },
    { skew: 17, pass: 4, counted: false },
  ])(
    'a lease held at 0 is counted by a reader whose clock is $skew s ahead at 10 s plus $pass s less 1 ms: $counted',
    async ({ skew, pass, counted }) => {
      const store = sharedStore();
      const a = member(store, 'A');
      const b = member(store, 'B', skew * 1_000);
      await a.ask(1);
      store.clock.now = (10 + pass) * 1_000 - 1;
      const answer = b.ask(1);
      if (counted) await expect(answer).rejects.toMatchObject(at(1));
      else await expect(answer).resolves.toBeTypeOf('function');
    },
  );
});
