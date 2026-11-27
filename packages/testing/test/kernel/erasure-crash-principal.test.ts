import { afterEach, expect, test } from 'vitest';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { bootCleared, type clearedApp, keyOf } from './support/erasure-cleared-kit.ts';

const running: TestRuntime<typeof clearedApp>[] = [];
afterEach(async () => {
  for (const runtime of running.splice(0)) await runtime.stop();
});

/**
 * ada owns a row through a holder and acts through it as her principal (as a session row of hers
 * would be). The pass crashes right after the unit that erased the row; then the holder is handed
 * to bea, so no later lookup finds the row any more; then the erasure is repaired from the `erased`
 * event that the row's unit left.
 */
async function crashAfterTheRowsUnit(handed: boolean) {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder', owner: b.ada });
  const plain = await b.mk({ kind: 'plain', holderId: holder, secret: 'ada secret' });
  const key = keyOf((await b.rowOf('cz.plain', plain))?.secret);
  const sent = await b.ping(b.ada, plain);
  expect((sent.result as { ok?: boolean }).ok).toBe(true);
  expect(await b.rowOf('core.commandReceipt', sent.commandId)).toMatchObject({
    principalId: plain,
  });
  let crashed = false;
  b.hook.after = async (step) => {
    if (step !== 'streams' || crashed) return;
    if ((await b.rowOf('cz.plain', plain))?.kwErasedAt == null) return;
    crashed = true;
    throw new Error('crash right after the unit of the row');
  };
  await b.request();
  expect(await b.once()).toBe(0);
  expect(crashed).toBe(true);
  delete b.hook.after;
  // The unit of the row left its answer and purged nothing.
  expect(await b.rowOf('core.commandReceipt', sent.commandId)).toMatchObject({
    principalId: plain,
  });
  if (handed) await b.operator.invoke('cz.give', { id: holder, owner: b.bea } as never);
  expect(await b.finish()).toBeGreaterThan(0);
  return {
    receipt: await b.rowOf('core.commandReceipt', sent.commandId),
    erased: (await b.rowOf('cz.plain', plain))?.kwErasedAt != null,
    opens: await b.opens(key),
  };
}

test('the receipts of the principal a row stands for go in a unit after the one that erased it, found by the answer that unit left, whatever happens to its holder after a crash', {
  timeout: 60_000,
}, async () => {
  expect(await crashAfterTheRowsUnit(true)).toEqual({
    receipt: undefined,
    erased: true,
    opens: false,
  });
});

test('control: the same crash, its holder not moved, purges the receipts', {
  timeout: 60_000,
}, async () => {
  expect(await crashAfterTheRowsUnit(false)).toEqual({
    receipt: undefined,
    erased: true,
    opens: false,
  });
});
