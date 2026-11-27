import { afterEach, expect, test } from 'vitest';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { bootCleared, type clearedApp, keyOf } from './support/erasure-cleared-kit.ts';

const running: TestRuntime<typeof clearedApp>[] = [];
afterEach(async () => {
  for (const runtime of running.splice(0)) await runtime.stop();
});

const erasedAt = async (b: Awaited<ReturnType<typeof bootCleared>>, id: string) =>
  (await b.rowOf('cz.memo', id))?.kwErasedAt != null;

/**
 * Ada owns a memo (a secret) that holds a value of ada through another field or, in the control,
 * only values of bea. Her erasure records the tombstone of the memo's key, then the sink fails: the
 * pass ends before the memo's unit. The memo's owner is cleared, and the erasure runs again.
 * Whichever way the repair reaches the memo, a tombstone of this erasure names it as hers.
 */
async function crashedBeforeTheUnit(holdsOwnValue: boolean) {
  const b = await bootCleared(running);
  const memo = await b.mk({
    kind: 'memo',
    owner: b.ada,
    aboutId: holdsOwnValue ? b.ada : b.bea,
    otherId: b.bea,
    about: 'about the first',
    other: 'about bea',
    secret: 'memo secret',
  });
  const key = keyOf((await b.rowOf('cz.memo', memo))?.secret);
  let failed = false;
  b.hook.refuse = (r) => {
    const hit = !failed && r.type === 'keyTombstone' && r.keyId === key;
    failed ||= hit;
    return hit;
  };
  await b.request();
  expect(await b.once()).toBe(0);
  // The ledger holds the tombstone (first), no sink does, and the memo is still there.
  expect(await b.inLedger(key)).toBe(true);
  expect(b.inSink(key)).toBe(false);
  expect(await erasedAt(b, memo)).toBe(false);
  await b.operator.invoke('cz.give', { id: memo, kind: 'memo' } as never);
  expect(await b.finish()).toBeGreaterThan(0);
  return { erased: await erasedAt(b, memo), opens: await b.opens(key), sink: b.inSink(key) };
}

test('a row of ada that also holds a value of ada, and whose owner was cleared after the crash, is erased by the repair', {
  timeout: 60_000,
}, async () => {
  expect(await crashedBeforeTheUnit(true)).toEqual({
    erased: true,
    opens: false,
    sink: true,
  });
});

test('control: the same row with no value of ada is erased by the repair', {
  timeout: 60_000,
}, async () => {
  expect(await crashedBeforeTheUnit(false)).toEqual({
    erased: true,
    opens: false,
    sink: true,
  });
});

/**
 * A memo that ada's erasure tombstoned and then spared because it was handed to bea meanwhile (the
 * named gap), or, in the control, that was bea's from the start. Bea's erasure finds it and
 * records its own tombstone for the key; the sink fails at it (the pass ends before the unit), the
 * owner is cleared, and bea's erasure runs again. The ledger look-up for the tombstone is by key
 * and command, so ada's tombstone does not stand for bea's.
 */
async function handedThenCrashed(handed: boolean) {
  const b = await bootCleared(running);
  const carl = await b.mk({ kind: 'member', email: 'carl@example.test' });
  const memo = await b.mk({
    kind: 'memo',
    owner: handed ? b.ada : b.bea,
    aboutId: carl,
    otherId: carl,
    about: 'about carl',
    other: 'about carl too',
    secret: 'memo secret',
  });
  const key = keyOf((await b.rowOf('cz.memo', memo))?.secret);
  if (handed) {
    b.hook.key = key;
    b.hook.run = async () => {
      await b.operator.invoke('cz.give', { id: memo, kind: 'memo', owner: b.bea } as never);
    };
    await b.request();
    expect(await b.finish()).toBeGreaterThan(0);
    // The named gap: spared, its key open, ada's tombstone standing.
    expect(await erasedAt(b, memo)).toBe(false);
    expect(await b.opens(key)).toBe(true);
  }
  await b.request(b.bea);
  const command = await b.erasureCommand(b.bea);
  let failed = false;
  b.hook.refuse = (r) => {
    const hit = !failed && r.type === 'keyTombstone' && r.keyId === key && r.commandId === command;
    failed ||= hit;
    return hit;
  };
  expect(await b.once()).toBe(0);
  expect(failed).toBe(true);
  expect(await erasedAt(b, memo)).toBe(false);
  await b.operator.invoke('cz.give', { id: memo, kind: 'memo' } as never);
  expect(await b.finish()).toBeGreaterThan(0);
  return {
    erased: await erasedAt(b, memo),
    opens: await b.opens(key),
    ledger: (await b.tombstonesOf(key)).map((id) => (id === command ? 'bea' : 'ada')),
    sink: b.inSink(key),
  };
}

test("a key that holds another erasure's tombstone gets this erasure's own, so the crash is repaired", {
  timeout: 60_000,
}, async () => {
  expect(await handedThenCrashed(true)).toEqual({
    erased: true,
    opens: false,
    ledger: ['ada', 'bea'],
    sink: true,
  });
});

test('control: a key with no earlier tombstone has one, naming this erasure', {
  timeout: 60_000,
}, async () => {
  expect(await handedThenCrashed(false)).toEqual({
    erased: true,
    opens: false,
    ledger: ['bea'],
    sink: true,
  });
});
