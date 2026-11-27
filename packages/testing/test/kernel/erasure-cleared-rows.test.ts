import { afterEach, expect, test } from 'vitest';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { bootCleared, type clearedApp, keyOf } from './support/erasure-cleared-kit.ts';

const running: TestRuntime<typeof clearedApp>[] = [];
afterEach(async () => {
  for (const runtime of running.splice(0)) await runtime.stop();
});

type Booted = Awaited<ReturnType<typeof bootCleared>>;

/** What a row left of its erasure: erased or not, its owner's holder, whether its key opens, where its tombstone is. */
async function facts(b: Booted, entity: string, id: string, key: string) {
  const row = await b.rowOf(entity, id);
  return {
    erased: row?.kwErasedAt !== undefined && row?.kwErasedAt !== null,
    opens: await b.opens(key),
    ledger: await b.inLedger(key),
    sink: b.inSink(key),
  };
}

const gone = { erased: true, opens: false, ledger: true, sink: true };

test('an item found by the reference walk whose holder is cleared as its key tombstone is taken is erased, its tombstone true', {
  timeout: 60_000,
}, async () => {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder', owner: b.ada });
  const item = await b.mk({
    kind: 'item',
    holderId: holder,
    note: 'ada note',
    secret: 'ada secret',
  });
  b.hook.key = keyOf((await b.rowOf('cz.item', item))?.secret);
  let cleared: unknown;
  b.hook.run = async () => {
    cleared = await b.operator.attempt('cz.give', { id: holder } as never);
  };
  await b.request();
  expect(await b.finish()).toBeGreaterThan(0);

  expect(cleared).toMatchObject({ ok: true });
  expect(await facts(b, 'cz.item', item, b.hook.key)).toEqual(gone);
});

/** A row that stopped being ada's before the erasure read it: nothing names it as hers, so nothing erases it (the named gap, probe P3). */
const untouched = { erased: false, opens: true, ledger: false, sink: false };

test('a row that holds a value of ada and whose holder is cleared before the walks reach it is not found as hers: it is left as it is', {
  timeout: 60_000,
}, async () => {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder', owner: b.ada });
  const item = await b.mk({
    kind: 'item',
    holderId: holder,
    note: 'ada note',
    secret: 'ada secret',
  });
  const key = keyOf((await b.rowOf('cz.item', item))?.secret);
  let cleared: unknown;
  b.hook.after = async (step) => {
    if (step !== 'tombstones') return;
    delete b.hook.after;
    cleared = await b.operator.attempt('cz.give', { id: holder } as never);
  };
  await b.request();
  expect(await b.finish()).toBeGreaterThan(0);

  expect(cleared).toMatchObject({ ok: true });
  expect(await facts(b, 'cz.item', item, key)).toEqual(untouched);
});

test('a row with no personal value whose holder is cleared before the lookup reads it is not found either (probe P3)', {
  timeout: 60_000,
}, async () => {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder', owner: b.ada });
  const plain = await b.mk({ kind: 'plain', holderId: holder, secret: 'ada secret' });
  const key = keyOf((await b.rowOf('cz.plain', plain))?.secret);
  let cleared: unknown;
  b.hook.after = async (step) => {
    if (step !== 'tombstones') return;
    delete b.hook.after;
    cleared = await b.operator.attempt('cz.give', { id: holder } as never);
  };
  await b.request();
  expect(await b.finish()).toBeGreaterThan(0);

  expect(cleared).toMatchObject({ ok: true });
  expect(await facts(b, 'cz.plain', plain, key)).toEqual(untouched);
});

test('a row the lookup of the owned rows found, whose holder is cleared before its unit, is erased with its key', {
  timeout: 60_000,
}, async () => {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder', owner: b.ada });
  const plain = await b.mk({ kind: 'plain', holderId: holder, secret: 'ada secret' });
  const key = keyOf((await b.rowOf('cz.plain', plain))?.secret);
  b.hook.key = key;
  let cleared: unknown;
  b.hook.run = async () => {
    cleared = await b.operator.attempt('cz.give', { id: holder } as never);
  };
  await b.request();
  expect(await b.finish()).toBeGreaterThan(0);

  expect(cleared).toMatchObject({ ok: true });
  expect(await facts(b, 'cz.plain', plain, key)).toEqual(gone);
});

/**
 * A row with no personal value and a key tombstone that an earlier pass left: that pass crashed in
 * the row's unit, and the holder changed before the pass that repairs it.
 */
async function crashedBeforeTheRowsUnit(change: 'clear' | 'hand' | 'none') {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder', owner: b.ada });
  const plain = await b.mk({ kind: 'plain', holderId: holder, secret: 'ada secret' });
  const key = keyOf((await b.rowOf('cz.plain', plain))?.secret);
  b.hook.key = key;
  let armed = false;
  b.hook.run = async () => {
    armed = true;
  };
  b.hook.inside = async (step) => {
    if (step !== 'streams' || !armed) return;
    armed = false;
    throw new Error('crash in the unit of the row');
  };
  await b.request();
  expect(await b.once()).toBe(0);
  expect((await facts(b, 'cz.plain', plain, key)).opens).toBe(true);
  expect(await b.inLedger(key)).toBe(true);
  delete b.hook.inside;
  if (change === 'clear') await b.operator.invoke('cz.give', { id: holder } as never);
  if (change === 'hand') await b.operator.invoke('cz.give', { id: holder, owner: b.bea } as never);
  expect(await b.finish()).toBeGreaterThan(0);
  return facts(b, 'cz.plain', plain, key);
}

test('a row that neither walk finds any more is erased through the key record that names it', {
  timeout: 60_000,
}, async () => {
  expect(await crashedBeforeTheRowsUnit('clear')).toEqual(gone);
});

test('control: the same row, its owner unchanged, is erased', { timeout: 60_000 }, async () => {
  expect(await crashedBeforeTheRowsUnit('none')).toEqual(gone);
});

test('the key record of a row that another subject owns now leaves it alone with its key (the named gap)', {
  timeout: 60_000,
}, async () => {
  expect(await crashedBeforeTheRowsUnit('hand')).toEqual({
    erased: false,
    opens: true,
    ledger: true,
    sink: true,
  });
});
