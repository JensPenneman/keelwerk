import { afterEach, expect, test } from 'vitest';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { bootCleared, type clearedApp, keyOf } from './support/erasure-cleared-kit.ts';

const running: TestRuntime<typeof clearedApp>[] = [];
afterEach(async () => {
  for (const runtime of running.splice(0)) await runtime.stop();
});

const erasedAt = async (b: Awaited<ReturnType<typeof bootCleared>>, entity: string, id: string) =>
  (await b.rowOf(entity, id))?.kwErasedAt != null;

/**
 * A row with no owner that holds a value of ada and a value of bea, and bea acts through the id of
 * the row as her principal (probe N). Nobody owns it, and it was never ada's.
 */
test('a row that nobody owns and that only holds a value of ada keeps its key, its other values and the receipts of the principal it stands for', {
  timeout: 60_000,
}, async () => {
  const b = await bootCleared(running);
  const memo = await b.mk({
    kind: 'memo',
    aboutId: b.ada,
    otherId: b.bea,
    about: 'about ada',
    other: 'about bea',
    secret: 'memo secret',
  });
  const key = keyOf((await b.rowOf('cz.memo', memo))?.secret);
  const sent = await b.ping(b.bea, memo);
  expect((sent.result as { ok?: boolean }).ok).toBe(true);
  await b.request();
  expect(await b.finish()).toBeGreaterThan(0);

  expect(await erasedAt(b, 'cz.memo', memo)).toBe(false);
  // Only the value of ada is cleared, and the row's own event says it was not hers.
  expect(await b.answerOf('cz.memo', memo)).toEqual({
    subjectId: b.ada,
    fields: ['about'],
    owned: false,
  });
  expect(await b.opens(key)).toBe(true);
  expect(await b.inLedger(key)).toBe(false);
  expect(await b.rowOf('core.commandReceipt', sent.commandId)).toMatchObject({ principalId: memo });
});

test('a key that this erasure recorded a tombstone for, whose row is gone, stays open (named)', {
  timeout: 60_000,
}, async () => {
  const b = await bootCleared(running);
  const key = await b.keyOfGoneRow('cz.plain', crypto.randomUUID());
  await b.request();
  await b.plant(key, await b.erasureCommand());
  expect(await b.finish()).toBeGreaterThan(0);
  expect(await b.opens(key)).toBe(true);
});

/**
 * A plain row with no personal value, owned through a holder of ada's, that someone acts through.
 * A tombstone for its key is in the control ledger after ada's record (that of another erasure
 * that spared the row, or one of her own that a crash left), its holder is cleared before the
 * lookup runs, and then the erasure runs (probe G2): a tombstone of another erasure names no row
 * for hers, and one of her own does.
 */
async function otherErasuresTombstone(named: 'another' | 'this') {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder', owner: b.ada });
  const plain = await b.mk({ kind: 'plain', holderId: holder, secret: 'ada secret' });
  const key = keyOf((await b.rowOf('cz.plain', plain))?.secret);
  const sent = await b.ping(b.bea, plain);
  expect((sent.result as { ok?: boolean }).ok).toBe(true);
  await b.request();
  const command = named === 'this' ? await b.erasureCommand() : crypto.randomUUID();
  await b.plant(key, command);
  await b.operator.invoke('cz.give', { id: holder } as never);
  expect(await b.finish()).toBeGreaterThan(0);
  return {
    erased: await erasedAt(b, 'cz.plain', plain),
    opens: await b.opens(key),
    receipt: (await b.rowOf('core.commandReceipt', sent.commandId)) !== undefined,
  };
}

test("another erasure's tombstone for the key of a row names no row: the row is left with its key and the receipts of its principal", {
  timeout: 60_000,
}, async () => {
  expect(await otherErasuresTombstone('another')).toEqual({
    erased: false,
    opens: true,
    receipt: true,
  });
});

test('control: a tombstone that names this erasure for a row whose holder was cleared since names the row, and it is erased', {
  timeout: 60_000,
}, async () => {
  expect(await otherErasuresTombstone('this')).toEqual({
    erased: true,
    opens: false,
    receipt: false,
  });
});
