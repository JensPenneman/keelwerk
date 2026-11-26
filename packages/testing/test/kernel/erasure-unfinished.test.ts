import { afterEach, describe, expect, test } from 'vitest';
import { boot, erasures, failed, resetOwnErasure, stepFault } from './support/own-erasure-kit.ts';

afterEach(resetOwnErasure);

const message = 'an erasure could not be finished; it is tried again';

describe.each(['memory', 'pglite'] as const)(
  'an erasure the worker cannot finish on %s',
  (adapter) => {
    test('U1: a step that throws on three passes logs one error, the receipt stays accepted, and the erasure finishes once the step works', async () => {
      const { runtime, operator, worker, ledger, rows, keyLive } = await boot(adapter);
      const itemId = String((await operator.invoke('oes.make', { note: 'mine' })).itemId);
      const asked = { subjectId: itemId, reason: 'operator' };
      expect((await operator.attempt('core.eraseSubject', asked)).ok).toBe(true);
      await runtime.drainJobs();
      stepFault.at = 'shred';
      for (let pass = 0; pass < 3; pass += 1) {
        await worker.pass();
        await runtime.advanceTo(runtime.clock.now().add({ hours: 2 }));
      }
      expect(failed.filter((line) => line === message)).toHaveLength(1);
      const [record] = erasures(await ledger());
      const status = async () =>
        (await rows('core.commandReceipt', false)).find(
          (row) => row.commandId === record?.commandId,
        )?.status;
      expect(await status()).toBe('accepted');
      stepFault.at = undefined;
      await worker.pass();
      expect(await status()).toBe('completed');
      expect(await keyLive(itemId)).toBe(false);
    });
  },
);
