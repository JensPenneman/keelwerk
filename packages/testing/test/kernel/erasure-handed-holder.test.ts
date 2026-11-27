import type { ErasureStep } from '@keelwerk/core';
import { afterEach, expect, test } from 'vitest';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { bootCleared, type clearedApp, keyOf } from './support/erasure-cleared-kit.ts';

const running: TestRuntime<typeof clearedApp>[] = [];
afterEach(async () => {
  for (const runtime of running.splice(0)) await runtime.stop();
});

/**
 * A deed owned through a holder that nobody owns holds a value of ada and a secret. Ada's erasure
 * reaches it through her references and answers it as a mere holder (the value is cleared). The
 * holder is then given to ada (the write is accepted: the erasure does not refuse it) after the
 * first step `when` that finds the deed's value cleared, or never (`undefined`). The lookup of the
 * owned rows then finds the deed again, or, for a hand-over after the lookup, does not.
 */
async function holderAnswered(when: ErasureStep | undefined) {
  const b = await bootCleared(running);
  const holder = await b.mk({ kind: 'holder' });
  const deed = await b.mk({
    kind: 'deed',
    holderId: holder,
    aboutId: b.ada,
    about: 'about ada',
    secret: 'deed secret',
  });
  const key = keyOf((await b.rowOf('cz.deed', deed))?.secret);
  let given = false;
  b.hook.after = async (step) => {
    if (step !== when || given) return;
    if ((await b.rowOf('cz.deed', deed))?.about != null) return;
    given = true;
    await b.operator.invoke('cz.give', { id: holder, owner: b.ada } as never);
  };
  await b.request();
  expect(await b.finish()).toBeGreaterThan(0);
  expect(given).toBe(when !== undefined);
  const command = await b.erasureCommand(b.ada);
  const row = await b.rowOf('cz.deed', deed);
  return {
    erased: row?.kwErasedAt != null,
    valueCleared: row?.about == null,
    opens: await b.opens(key),
    ledger: (await b.tombstonesOf(key)).map((id) => (id === command ? 'ada' : id)),
    sink: b.inSink(key),
  };
}

test('a row whose holder is given to the subject right after the row was answered as a mere holder is erased', {
  timeout: 60_000,
}, async () => {
  expect(await holderAnswered('streams')).toEqual({
    erased: true,
    valueCleared: true,
    opens: false,
    ledger: ['ada'],
    sink: true,
  });
});

test('control: the same order with no hand-over leaves the row a mere holder, and only the value is cleared', {
  timeout: 60_000,
}, async () => {
  expect(await holderAnswered(undefined)).toEqual({
    erased: false,
    valueCleared: true,
    opens: true,
    ledger: [],
    sink: false,
  });
});

test('a holder given to the subject only after the walks have read the row leaves the row hers, not erased and with its key open', {
  timeout: 60_000,
}, async () => {
  expect(await holderAnswered('principals')).toEqual({
    erased: false,
    valueCleared: true,
    opens: true,
    ledger: [],
    sink: false,
  });
});
