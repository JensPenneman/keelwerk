import { describe, expect, test, vi } from 'vitest';
import { errors } from '../errors/errors.ts';
import type { Unit } from '../storage/unit.ts';
import { settleEffect } from './settle-effect.ts';
import { settleKeepingContinuation } from './settle-keeping-continuation.ts';

vi.mock('./settle-effect.ts', () => ({ settleEffect: vi.fn(() => Promise.resolve(true)) }));

/** A unit whose nested unit is the unit itself: the settle under test never reads it. */
const unit = { nested: (work: (inner: Unit) => Promise<unknown>) => work(unit as Unit) } as Unit;
const target = {
  entry: {},
  row: {},
} as unknown as Parameters<typeof settleKeepingContinuation>[1];
const settled = { status: 'succeeded', output: {} } as const;

/** A settlement whose first build fails with `error` (the nested try) and whose second goes through. */
function failingOnce(error: unknown) {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === 1) throw error;
    return Promise.resolve(settled);
  };
}

describe('settleKeepingContinuation', () => {
  test.each([
    ['internal', errors.internal('the continuation is gone')],
    ['validation', errors.validation('The input no longer fits the command.')],
  ])('a %s refusal of the continuation settles again without it', async (_kind, error) => {
    vi.mocked(settleEffect).mockClear();
    const written = await settleKeepingContinuation(unit, target, failingOnce(error), 1);
    expect(written).toEqual(settled);
    expect(settleEffect).toHaveBeenCalledTimes(1);
    expect(vi.mocked(settleEffect).mock.calls[0]?.[1]).toMatchObject({ continuation: 'skip' });
  });

  test.each([
    ['a store error', new Error('the store failed')],
    ['a conflict', errors.conflict('The row changed.')],
  ])('%s is rethrown: a known continuation is never dropped', async (_name, error) => {
    await expect(settleKeepingContinuation(unit, target, failingOnce(error), 1)).rejects.toBe(
      error,
    );
  });
});
