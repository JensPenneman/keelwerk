import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA } = conformanceScopes;

/**
 * The time of a shared token bucket (S-36) when the processes that take from it have clocks that
 * differ, against the bucket store of every adapter.
 */
export function storeBucketSkewCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  test('takes from processes whose clocks differ never credit the difference twice', async () => {
    const { clock } = subject;
    if (clock === undefined) throw new Error('The conformance target has no clock to move.');
    const limits = { capacity: 1000, refillPerSecond: 0.1 };
    const take = (cost: number) =>
      subject.run(tenantA, (unit) => unit.buckets.take('skewed', cost, limits));
    await take(1000);
    // One process runs 100 s ahead of the other and they alternate: the row is credited the
    // 10 tokens of that difference once, never again for every pair of takes.
    let admitted = 0;
    for (let pair = 0; pair < 30; pair += 1) {
      clock.advance(100_000);
      if ((await take(1)).ok) admitted += 1;
      clock.advance(-100_000);
      if ((await take(1)).ok) admitted += 1;
    }
    expect(admitted).toBeGreaterThanOrEqual(10);
    expect(admitted).toBeLessThanOrEqual(12);
  });
}
