import { describe, expect, test } from 'vitest';
import { at, member, other, refused, scopeId, sharedStore } from '../../test/quotas/lease-kit.ts';
import { errors } from '../errors/errors.ts';

// The counter of one process against the shared store of the kit: two processes share one store and one
// clock that the test moves by hand. Nothing here waits for time.

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

describe('a store that fails', () => {
  const away = () => errors.unavailable('The control store is away.');

  test('a take that needs a write is refused with the error of the store, one within the held units is admitted', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const [first] = await Promise.all([a.ask(5), a.ask(5)]);
    first();
    a.state.failure = away();
    await expect(a.ask(5)).resolves.toBeTypeOf('function');
    await expect(a.ask(5)).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
  });

  test('a take within the held units goes to the write, which fails, when the total last answered stands over its limit', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first] = await Promise.all([a.ask(3), a.ask(3)]);
    await b.ask(3);
    await a.counter.pass();
    first();
    a.state.failure = away();
    await expect(a.ask(2)).rejects.toMatchObject({ code: 'core.unavailable' });
  });

  test('a slot that ended counts until its lease lapses, thirty seconds after the process last wrote it, and no longer', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    (await a.ask(1))();
    a.state.failure = away();
    await expect(a.counter.pass()).rejects.toMatchObject({ code: 'core.unavailable' });
    store.clock.now = 29_999;
    await expect(b.ask(1)).rejects.toMatchObject(at(1));
    store.clock.now = 30_000;
    await expect(b.ask(1)).resolves.toBeTypeOf('function');
  });

  test('a take that waits for a renew that fails is refused with the error of the store, and its write does not start before the renew has ended', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const [first] = await Promise.all([a.ask(5), a.ask(5)]);
    first();
    const open = a.hold();
    const passing = a.counter.pass();
    const writes = a.state.writes;
    const waiting = expect(a.ask(5)).rejects.toMatchObject({ code: 'core.unavailable' });
    // The renew is the one write in flight: the take's own write has not started.
    expect(a.state.writes).toBe(writes);
    a.state.failure = away();
    const failed = expect(passing).rejects.toMatchObject({ code: 'core.unavailable' });
    open();
    await failed;
    await waiting;
    expect(a.state.writes).toBe(writes + 1);
  });
});
