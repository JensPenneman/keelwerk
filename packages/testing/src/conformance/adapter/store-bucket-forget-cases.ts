import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA, tenantB } = conformanceScopes;

/**
 * Forgetting shared token buckets (S-36, 14.7.5), against the bucket store of every adapter: the
 * named buckets of the unit's scope are deleted and counted, a bucket that does not exist counts
 * nothing, and a bucket of the same name in another scope stays.
 */
export function storeBucketForgetCases(subject: Pick<ConformanceSubject, 'run'>): void {
  const limits = { capacity: 3, refillPerSecond: 0.001 };

  test('forgetting deletes the named buckets of this scope, counts them and finds none the second time', async () => {
    await subject.run(tenantA, async (unit) => {
      for (const name of ['f1', 'f2', 'f3']) await unit.buckets.take(name, 3, limits);
    });
    await subject.run(tenantB, (unit) => unit.buckets.take('f1', 3, limits));
    expect(await subject.run(tenantA, (unit) => unit.buckets.forget(['f1', 'f2', 'never']))).toBe(
      2,
    );
    expect(await subject.run(tenantA, (unit) => unit.buckets.forget(['f1', 'f2']))).toBe(0);
    expect(await subject.run(tenantA, (unit) => unit.buckets.forget([]))).toBe(0);
    // A forgotten bucket is full again; the one that was not named is still empty, and so is the other scope's.
    const reads = await subject.run(tenantA, async (unit) => [
      await unit.buckets.check('f1', 3, limits),
      await unit.buckets.check('f3', 1, limits),
    ]);
    expect(reads.map((read) => read.ok)).toEqual([true, false]);
    expect((await subject.run(tenantB, (unit) => unit.buckets.check('f1', 1, limits))).ok).toBe(
      false,
    );
  });
}
