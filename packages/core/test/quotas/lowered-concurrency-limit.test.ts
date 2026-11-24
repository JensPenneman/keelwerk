import { describe, expect, test } from 'vitest';
import { at, member, other, scopeId, sharedStore } from './lease-kit.ts';

describe('a lowered limit', () => {
  test('binds under churn: a slot that ends and is taken again does not keep the count, nothing is closed, and the other tenant is not touched', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const open = await Promise.all([a.ask(3), a.ask(3), a.ask(3)]);
    // B keeps a slot of another tenant open through the case.
    await b.ask(9, 'subscriptions', other);
    // The limit is now 1. Each round: one slot ends, one is taken, then the pass of A.
    const outcomes: string[] = [];
    const totals: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      open.shift()?.();
      await a.ask(1).then(
        (release) => {
          open.push(release);
          outcomes.push('admitted');
        },
        (error: unknown) => {
          expect(error).toMatchObject(at(1));
          outcomes.push('refused');
        },
      );
      await a.counter.pass();
      totals.push(store.totalOf('subscriptions', scopeId));
      await expect(b.ask(9, 'subscriptions', other)).resolves.toBeTypeOf('function');
    }
    expect(outcomes).toEqual(['refused', 'refused', 'admitted', 'admitted', 'admitted']);
    expect(totals).toEqual([2, 1, 1, 1, 1]);
    expect(store.totalOf('subscriptions', other)).toBe(1 + 5);
  });

  test('binds across holders: a take within the slots a process holds is admitted until its pass, after it none is while the count stands at or over the limit, and the total comes down as slots end', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const mine = await a.ask(3);
    const [first, second] = await Promise.all([b.ask(3), b.ask(3)]);
    mine();
    // The limit is now 1. A's last answer was a total of 1: its take is admitted within the slot it holds.
    const window = await a.ask(1);
    expect(store.totalOf('subscriptions', scopeId)).toBe(3);
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(3);
    // While the slot of A is open its own use refuses at once; once it has ended, the total last answered does.
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
    await expect(b.ask(1)).rejects.toMatchObject(at(1));
    window();
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    first();
    await b.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(1);
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
    second();
    await b.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(0);
    await expect(a.ask(1)).resolves.toBeTypeOf('function');
  });

  test('comes down to the limit and stays there when both processes end and take a slot in every round', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const open = new Map([
      [a, await Promise.all([a.ask(3), a.ask(3)])],
      [b, [await b.ask(3)]],
    ]);
    expect(store.totalOf('subscriptions', scopeId)).toBe(3);
    // The limit is now 1; each round every process ends its oldest slot, takes one and passes.
    const totals: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      for (const process of [a, b]) {
        const slots = open.get(process) ?? [];
        slots.shift()?.();
        await process.ask(1).then(
          (release) => slots.push(release),
          () => undefined,
        );
        await process.counter.pass();
      }
      totals.push(store.totalOf('subscriptions', scopeId));
    }
    expect(totals.every((total, index) => total <= (totals[index - 1] ?? 3))).toBe(true);
    expect(totals.at(-1)).toBe(1);
    expect([...open.values()].flat()).toHaveLength(1);
  });

  test('a process whose own slots stand at the limit refuses at once, with no write', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    await Promise.all([a.ask(2), a.ask(2)]);
    const writes = a.state.writes;
    await expect(a.ask(2)).rejects.toMatchObject(at(2));
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
    expect(a.state.writes).toBe(writes);
  });

  test('takes that share a write are each judged by their own limit, and a refusal names its own', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    await b.ask(9);
    const open = a.hold();
    const settled = [a.ask(5), a.ask(2), a.ask(5)].map((take) =>
      take.then(
        () => 'admitted',
        (error: { details: { limit: number } }) => `refused at ${error.details.limit}`,
      ),
    );
    open();
    // The first take makes 2 with the slot of B; the second would make 3 against its limit of 2, the third 3 against 5.
    expect(await Promise.all(settled)).toEqual(['admitted', 'refused at 2', 'admitted']);
    expect(store.totalOf('subscriptions', scopeId)).toBe(3);
  });

  test('a slot that ended counts until the pass of its process, also while the process takes others', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first, second] = await Promise.all([a.ask(2), a.ask(2)]);
    first();
    await a.ask(2);
    second();
    await expect(b.ask(2)).rejects.toMatchObject(at(2));
    await a.counter.pass();
    await expect(b.ask(2)).resolves.toBeTypeOf('function');
  });

  test('a slot that ended during a write of its pair that the pass met counts until the pass after it', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const slot = await a.ask(2);
    // The next take of A writes with the slot it read in use; the slot ends and the pass meets the write.
    const open = a.hold();
    const taking = a.ask(2);
    slot();
    const passing = a.counter.pass();
    open();
    await Promise.all([taking, passing]);
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    await expect(b.ask(2)).rejects.toMatchObject(at(2));
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(1);
    await expect(b.ask(2)).resolves.toBeTypeOf('function');
  });

  test('a slot that ended before a write of its pair that the pass met counts until that write lands, and the write sets the lease', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first, second] = await Promise.all([a.ask(2), a.ask(2)]);
    first();
    second();
    // The next take of A (limit 1) goes to a write, which is held in the store.
    const writing = store.stallHold('A');
    const taking = a.ask(1);
    await writing.arrived;
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    await expect(b.ask(2)).rejects.toMatchObject(at(2));
    writing.release();
    await expect(taking).resolves.toBeTypeOf('function');
    expect(store.totalOf('subscriptions', scopeId)).toBe(1);
    await expect(b.ask(2)).resolves.toBeTypeOf('function');
  });

  test('a slot that ended before a write that failed counts until the pass after it', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first, second] = await Promise.all([a.ask(2), a.ask(2)]);
    first();
    second();
    const writing = store.stallHold('A');
    const taking = a.ask(1);
    const failed = expect(taking).rejects.toMatchObject({ code: 'core.unavailable' });
    await writing.arrived;
    await a.counter.pass();
    writing.fail(Object.assign(new Error('away'), { code: 'core.unavailable' }));
    await failed;
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    await expect(b.ask(2)).rejects.toMatchObject(at(2));
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(0);
    await expect(b.ask(2)).resolves.toBeTypeOf('function');
  });

  test('a take within the held slots waits for a write while a write of its pair is in flight, and is refused with the error of a store that is away', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const [first] = await Promise.all([a.ask(3), a.ask(3)]);
    const writing = store.stallHold('A');
    const hanging = a.ask(3);
    const away = Object.assign(new Error('away'), { code: 'core.unavailable' });
    const hangingFailed = expect(hanging).rejects.toMatchObject({ code: 'core.unavailable' });
    await writing.arrived;
    first();
    const writes = a.state.writes;
    // A unit is held that this take does not use and the last total is within 3, yet it waits for the next write.
    const further = a.ask(3);
    const furtherFailed = expect(further).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(a.state.writes).toBe(writes);
    writing.fail(away);
    await Promise.all([hangingFailed, furtherFailed]);
    expect(a.state.writes).toBe(writes + 1);
  });

  test('a take after the last write of the process is judged by the total that write answered, not by the units of the process', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    await Promise.all([b.ask(3), b.ask(3)]);
    // The write of A answers a total of 3; its slot ends and the limit is now 1.
    (await a.ask(3))();
    await expect(a.ask(1)).rejects.toMatchObject(at(1));
  });

  test('is not met by a lease that lapsed and is held again: the next take of that pair asks the store, and the count comes down as slots end', async () => {
    const store = sharedStore();
    const a = member(store, 'A');
    const b = member(store, 'B');
    const [first, second] = await Promise.all([a.ask(2), a.ask(2)]);
    store.clock.now += 31_000;
    await b.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(0);
    // A renews: its statement read the others before B's take wrote, and B counted none of A's slots.
    const stalled = store.stall();
    const passing = a.counter.pass();
    await stalled.arrived;
    await expect(b.ask(2)).resolves.toBeTypeOf('function');
    stalled.release();
    await passing;
    expect(store.totalOf('subscriptions', scopeId)).toBe(3);
    first();
    // A holds 2 units and uses 1, and the answer it holds says 2: it must not reuse them.
    const writes = a.state.writes;
    await expect(a.ask(2)).rejects.toMatchObject(at(2));
    expect(a.state.writes).toBe(writes + 1);
    expect(store.totalOf('subscriptions', scopeId)).toBe(2);
    second();
    await a.counter.pass();
    expect(store.totalOf('subscriptions', scopeId)).toBe(1);
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
