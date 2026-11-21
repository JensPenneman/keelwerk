import { describe, expect, test } from 'vitest';
import { acmeScope, jobOf, startWatched } from './support/worker-kit.ts';

/** Enqueues two jobs of `commands` in one unit, works them, and answers how many the first take that handed out jobs handed out. */
async function firstTakeSize(slots: number | undefined): Promise<number> {
  const { runtime, spy } = await startWatched({
    workers: { queues: ['commands'], ...(slots === undefined ? {} : { slots }) },
  });
  try {
    await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), async (unit) => {
      for (const commandId of [
        '00000000-0000-7000-8000-000000000001',
        '00000000-0000-7000-8000-000000000002',
      ]) {
        await unit.jobs.enqueue(
          jobOf(runtime, {
            queue: 'commands',
            run: { action: 'loans.closeAll', input: { borrower: 'bea' }, commandId },
            principal: { resolver: 'test.principal', principalId: 'bea' },
          }),
        );
      }
    });
    expect(await runtime.drainJobs()).toBe(2);
    const first = spy.takes.find((take) => take.jobs.length > 0);
    return first?.jobs.length ?? 0;
  } finally {
    await runtime.stop();
  }
}

describe('the slots of a test runtime worker', () => {
  test('a test runtime works a named queue with the slots its workers option gives', async () => {
    expect(await firstTakeSize(1)).toBe(1);
    expect(await firstTakeSize(undefined)).toBe(2);
  });
});
