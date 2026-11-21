import { describe, expect, test } from 'vitest';
import { receiptOf, stored } from './support/effects-kit.ts';
import { heldOverTheLimits } from './support/held-over-the-limits.ts';
import { boot } from './support/prepare-admission-world.ts';
import { namespace, tenant } from './support/run-read-kit.ts';
import { storedRecords } from './support/stored-bytes.ts';

// The unit of a command with `prepare` declares no storage limit at its commit tail, whichever
// action charges in it: a synchronous command that the decision or an inline reaction invokes in
// that unit is exempt with it, and so are its own inline reactions (12.2). Each case holds the first
// attempt in its executor, after its admission, puts the tenant above both limits and releases it.
// What decides each case: the barrier the test releases, the awaited answers, the executor's count,
// the committed store and the counters; no clock moves and nothing runs in the background.

describe('a synchronous command nested in the unit of a command with prepare', () => {
  /** Everything the held command stored is there, and both counters equal what the store holds. */
  async function expectAllStored(
    held: Awaited<ReturnType<typeof heldOverTheLimits>>,
    isbns: readonly string[],
  ) {
    const { world, adapter, registry, id, done, before } = held;
    expect(done.ok).toBe(true);
    expect(world.runs).toBe(1);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'completed' });
    expect((await stored(adapter)).books.map((book) => book.isbn).sort()).toEqual(
      [...isbns].sort(),
    );
    const records = await storedRecords(adapter, namespace, tenant, registry);
    expect(records.rows).toBe(BigInt(isbns.length));
    expect(records.rows).toBe(before[1] + BigInt(isbns.length - 1));
    expect(records.counted).toBe(records.stored);
    expect(records.counted).toBeGreaterThan(before[0]);
  }

  test('the decision invokes a command that stores a record: it is stored with the tenant above its limits', async () => {
    const held = await heldOverTheLimits('library.relay', { title: 'Nested', isbn: 'n-1' });
    await expectAllStored(held, ['g-1', 'n-1']);
  });

  test('the decision invokes a command whose inline reaction stores a second record in the same unit', async () => {
    const held = await heldOverTheLimits(
      'library.relay',
      { title: 'Echoed', isbn: 'n-1' },
      { echo: true },
    );
    await expectAllStored(held, ['echo-1', 'g-1', 'n-1']);
  });

  test('the decision invokes a command without prepare that invokes a command: two deep, still stored', async () => {
    const held = await heldOverTheLimits('library.relayDeep', { title: 'Deep', isbn: 'n-1' });
    await expectAllStored(held, ['g-1', 'n-1']);
  });

  test('an inline reaction of the command invokes a command that stores a record', async () => {
    const held = await heldOverTheLimits(
      'library.stock',
      { title: 'Relayed', isbn: 's-1' },
      { relay: true },
    );
    await expectAllStored(held, ['g-1', 'rl-1', 's-1']);
  });
});

describe('a synchronous command nested in the unit of a command without prepare', () => {
  test('is still refused by the limit of the tail, the unit stores nothing and the refusal is pinned to the id', async () => {
    const { world, adapter, invoke, read, registry } = boot();
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    world.bytes = 0;
    world.rows = 0;
    const before = await read();
    expect(before[0]).toBeGreaterThan(0n);
    const id = '00000000-0000-7000-8000-000000000211';
    expect(
      await invoke('library.relayPlain', { title: 'Nested', isbn: 'n-1' }, { commandId: id }),
    ).toMatchObject({
      ok: false,
      error: { code: 'core.quota_exceeded' },
    });
    expect((await stored(adapter)).books.map((book) => book.isbn)).toEqual(['g-1']);
    expect(await read()).toEqual(before);
    expect(await receiptOf(adapter, id)).toMatchObject({ status: 'failed' });
    const records = await storedRecords(adapter, namespace, tenant, registry);
    expect(records.counted).toBe(records.stored);
  });
});
