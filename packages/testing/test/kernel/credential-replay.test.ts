import { describe, expect, test } from 'vitest';
import { addBooks, commandKit, runDirect } from './support/command-kit.ts';
import {
  credentialProbes,
  firstId,
  mismatchRefusal,
  secondId,
  spied,
  spyKeys,
  storedReceipt,
  visible,
} from './support/credential-replay-kit.ts';
import { byHeaderCarrier, call } from './support/invoker-kit.ts';
import { anonymous } from './support/run-read-kit.ts';
import { refusal } from './support/runtime-kit.ts';

describe('a finished command repeated by a caller without a principal reference (WP-181)', () => {
  test('the same input and secret is refused, and the repeat loads, decides and stores nothing', async () => {
    const calls = { n: 0 };
    const { registry, ref } = credentialProbes(calls);
    const kit = commandKit({ registry });
    const spy = spied(kit.adapter);
    const used: string[] = [];
    const run = (input: unknown) =>
      runDirect({
        registry,
        adapter: spy.adapter,
        action: ref('door'),
        input,
        commandId: firstId,
        principal: anonymous,
        keys: spyKeys(used) as never,
      });
    const [bookId] = await addBooks(kit.adapter, 1);
    const input = { id: bookId, pin: '4711' };
    await run(input);
    const before = await storedReceipt(kit.adapter, firstId);
    expect(before.status).toBe('completed');
    expect(spy.log.length).toBeGreaterThan(0);
    spy.log.length = 0;
    used.length = 0;
    expect(visible(await refusal(run(input)))).toMatchObject(mismatchRefusal);
    expect(calls.n).toBe(1);
    expect(spy.log).toEqual([]);
    expect(used.filter((member) => member !== 'derive')).toEqual([]);
    expect(await storedReceipt(kit.adapter, firstId)).toEqual(before);
  });

  test('another secret and another non-secret input answer the same refusal', async () => {
    const calls = { n: 0 };
    const { registry, ref } = credentialProbes(calls);
    const { adapter } = commandKit({ registry });
    const [first, second] = await addBooks(adapter, 2);
    const run = (input: unknown) =>
      runDirect({
        registry,
        adapter,
        action: ref('door'),
        input,
        commandId: firstId,
        principal: anonymous,
      });
    await run({ id: first, pin: '4711' });
    const same = visible(await refusal(run({ id: first, pin: '4711' })));
    expect(same).toMatchObject(mismatchRefusal);
    expect(visible(await refusal(run({ id: first, pin: '0000' })))).toEqual(same);
    expect(visible(await refusal(run({ id: second, pin: '4711' })))).toEqual(same);
  });

  test('a failed receipt answers the same refusal as a completed one', async () => {
    const calls = { n: 0 };
    const { registry, ref } = credentialProbes(calls);
    const { adapter, invoker } = commandKit({ registry });
    const send = (commandId: string, pin: string) =>
      invoker.invoke(
        call(ref('gate'), { door: 'front', pin }, { carrier: byHeaderCarrier, commandId }),
      );
    expect((await send(firstId, '0000')).ok).toBe(false);
    expect((await send(secondId, '4711')).ok).toBe(true);
    const failedBefore = await storedReceipt(adapter, firstId);
    expect(failedBefore.status).toBe('failed');
    const failed = await send(firstId, '4711');
    const done = await send(secondId, '4711');
    if (failed.ok || done.ok) throw new Error('both repeats must be refused');
    expect(visible(failed.error)).toMatchObject(mismatchRefusal);
    expect(visible(done.error)).toEqual(visible(failed.error));
    // The refusal equals the one of a repeat that differs in its non-secret input.
    const unequal = await send(firstId, '4711').then(() =>
      invoker.invoke(
        call(
          ref('gate'),
          { door: 'back', pin: '4711' },
          { carrier: byHeaderCarrier, commandId: secondId },
        ),
      ),
    );
    if (unequal.ok) throw new Error('the unequal repeat must be refused');
    expect(visible(unequal.error)).toEqual(visible(failed.error));
    expect(await storedReceipt(adapter, firstId)).toEqual(failedBefore);
  });

  test('an action with a shown-once member answers the refusal, not the shown-once conflict', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter } = commandKit({ registry });
    const run = () =>
      runDirect({
        registry,
        adapter,
        action: ref('token'),
        input: { door: 'front', pin: '4711' },
        commandId: firstId,
        principal: anonymous,
      });
    await run();
    expect(visible(await refusal(run()))).toMatchObject(mismatchRefusal);
  });

  test('an optional credential member the call does not send', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter } = commandKit({ registry });
    const run = () =>
      runDirect({
        registry,
        adapter,
        action: ref('maybe'),
        input: { door: 'front' },
        commandId: firstId,
        principal: anonymous,
      });
    await run();
    expect(visible(await refusal(run()))).toMatchObject(mismatchRefusal);
  });

  test('a credential member inside a list or a nested object', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter } = commandKit({ registry });
    const cases: [string, unknown][] = [
      ['pins', { door: 'front', pins: ['1', '2'] }],
      ['nested', { door: 'front', guard: { pin: '1' } }],
    ];
    for (const [name, input] of cases) {
      const run = () =>
        runDirect({
          registry,
          adapter,
          action: ref(name),
          input,
          commandId: `00000000-0000-7000-8000-00000000${name === 'pins' ? '0d01' : '0d02'}`,
          principal: anonymous,
        });
      await run();
      expect(visible(await refusal(run()))).toMatchObject(mismatchRefusal);
    }
  });
});
