import { conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA } = conformanceScopes;

/**
 * The time of a shared token bucket (S-36) when the processes that take from it have clocks that
 * differ, against the bucket store of every adapter. A take never credits time its row is ahead of
 * the taking clock: a row at most five seconds ahead keeps its time and a refusal adds those
 * seconds to its `retryAfter`; a row further ahead is a clock jump and is dated at the take. A take
 * of cost 0 locks and refills the row and changes no token count.
 */
export function storeBucketSkewCases(subject: Pick<ConformanceSubject, 'run' | 'clock'>): void {
  const clockOf = () => {
    const { clock } = subject;
    if (clock === undefined) throw new Error('The conformance target has no clock to move.');
    return clock;
  };
  const bucketOf = (key: string, limits: { capacity: number; refillPerSecond: number }) => ({
    take: (cost: number) => subject.run(tenantA, (unit) => unit.buckets.take(key, cost, limits)),
    check: (cost: number) => subject.run(tenantA, (unit) => unit.buckets.check(key, cost, limits)),
    /** Takes 1 until a take is refused; how many were granted. */
    drain: async () => {
      let granted = 0;
      while ((await subject.run(tenantA, (unit) => unit.buckets.take(key, 1, limits))).ok) {
        granted += 1;
      }
      return granted;
    },
  });
  // The targets' clocks keep real time between the moves a case makes, so every real second a case
  // takes credits `refillPerSecond` tokens beyond what it moves the clock by. A case that counts
  // tokens at a refill of 1 a second reads how many real seconds it took and allows for them; a
  // case that does not count them refills so slowly that they cannot matter.
  const stopwatch = () => {
    const started = Date.now();
    return () => (Date.now() - started) / 1000;
  };
  /** A retryAfter within 50 s of what the refill rate gives, for a case of 0.001 tokens a second. */
  const expectNear = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThan(50);
  const retryAfterOf = (answer: { ok: boolean; retryAfter?: number | undefined }) =>
    answer.ok ? Number.NaN : (answer.retryAfter ?? Number.NaN);

  test('a row at most 5 s ahead of a take is credited once and refill goes on', async () => {
    const clock = clockOf();
    const bucket = bucketOf('skew-a', { capacity: 1000, refillPerSecond: 1 });
    await bucket.take(1000);
    const seconds = stopwatch();
    // One process runs 4 s ahead of the other and they alternate while time moves on 1 s a round:
    // each second is credited once, the 4 s of skew once.
    for (let round = 0; round < 10; round += 1) {
      clock.advance(4000);
      await bucket.take(0);
      clock.advance(-4000);
      await bucket.take(0);
      clock.advance(1000);
    }
    // 13 tokens were credited, and the real seconds the case took on top; the row is still 3 s
    // ahead of the clock less those, which a refusal adds to its retryAfter. A cost of 2 tokens
    // above what was credited needs 5 s from the row's time, whatever the real seconds were.
    expect((await bucket.check(13)).ok).toBe(true);
    const real = Math.ceil(seconds());
    const refused = retryAfterOf(await bucket.check(15 + real));
    expect(refused).toBeGreaterThan(4.5);
    expect(refused).toBeLessThan(5.5 + real);
    clock.advance(4000);
    expect((await bucket.check(14)).ok).toBe(true);
    const later = retryAfterOf(await bucket.check(15 + real));
    expect(later).toBeGreaterThan(0.9);
    expect(later).toBeLessThan(2.5 + real);
  });

  test('two clocks 4 s apart that alternate without time moving admit the skew once', async () => {
    const clock = clockOf();
    const bucket = bucketOf('skew-alternate', { capacity: 1000, refillPerSecond: 1 });
    await bucket.take(1000);
    const seconds = stopwatch();
    let admitted = 0;
    for (let pair = 0; pair < 30; pair += 1) {
      clock.advance(4000);
      if ((await bucket.take(1)).ok) admitted += 1;
      clock.advance(-4000);
      if ((await bucket.take(1)).ok) admitted += 1;
    }
    expect(admitted).toBeGreaterThanOrEqual(4);
    expect(admitted).toBeLessThanOrEqual(6 + Math.ceil(seconds()));
  });

  test('two clocks 4 s apart over 20 rounds admit the refill of the elapsed time', async () => {
    const clock = clockOf();
    const bucket = bucketOf('skew-window', { capacity: 1000, refillPerSecond: 1 });
    await bucket.take(1000);
    const seconds = stopwatch();
    let admitted = 0;
    for (let round = 0; round < 20; round += 1) {
      clock.advance(4000);
      admitted += await bucket.drain();
      clock.advance(-4000);
      admitted += await bucket.drain();
      clock.advance(10_000);
    }
    // The leading clock read 4 + 19 x 10 s after the bucket was emptied.
    expect(admitted).toBeGreaterThanOrEqual(194 - 5);
    expect(admitted).toBeLessThanOrEqual(194 + Math.ceil(seconds()) + 1);
  });

  test('a row 3 s ahead is refused with a retryAfter that adds the 3 s', async () => {
    const clock = clockOf();
    const bucket = bucketOf('skew-retry', { capacity: 1000, refillPerSecond: 1 });
    await bucket.take(1000);
    const seconds = stopwatch();
    clock.advance(3000);
    expect((await bucket.take(3)).ok).toBe(true);
    clock.advance(-3000);
    const refused = [await bucket.take(1), await bucket.check(1)];
    const real = seconds();
    for (const answer of refused) {
      // the 3 s the row is ahead, less the real seconds that passed, and the second the token needs
      expect(retryAfterOf(answer)).toBeGreaterThan(4 - real - 0.05);
      expect(retryAfterOf(answer)).toBeLessThanOrEqual(4);
    }
  });

  test('a row more than 5 s ahead is a clock jump and refills again from the take', async () => {
    const clock = clockOf();
    const bucket = bucketOf('skew-jump', { capacity: 10, refillPerSecond: 1 });
    await bucket.take(10);
    clock.advance(3_600_000);
    expect((await bucket.take(10)).ok).toBe(true);
    clock.advance(-3_600_000);
    // a check writes nothing and the row held 0 tokens at the take: no real seconds are credited
    expect(retryAfterOf(await bucket.check(1))).toBeCloseTo(1, 3);
    expect((await bucket.take(1)).ok).toBe(false);
    clock.advance(2000);
    expect((await bucket.take(2)).ok).toBe(true);
  });

  test('a clock that jumped 30 minutes ahead and took the whole bucket freezes it only until the next take', async () => {
    const clock = clockOf();
    const bucket = bucketOf('skew-freeze', { capacity: 1000, refillPerSecond: 1 });
    await bucket.take(1000);
    clock.advance(1_800_000);
    expect((await bucket.take(1000)).ok).toBe(true);
    clock.advance(-1_800_000);
    let admitted = 0;
    for (let at = 0; at < 20; at += 1) {
      if ((await bucket.take(1)).ok) admitted += 1;
      clock.advance(1000);
    }
    expect(admitted).toBeGreaterThanOrEqual(18);
    expect(admitted).toBeLessThanOrEqual(20);
  });

  test('a take of cost 0 changes no token count', async () => {
    const clock = clockOf();
    // A token takes 1,000 s to refill, so the real seconds the case takes credit next to nothing.
    const bucket = bucketOf('skew-zero', { capacity: 10, refillPerSecond: 0.001 });
    expect((await bucket.take(4)).ok).toBe(true);
    expect((await bucket.take(0)).ok).toBe(true);
    expect((await bucket.check(6)).ok).toBe(true);
    expectNear(retryAfterOf(await bucket.check(7)), 1000);
    clock.advance(500_000);
    expect((await bucket.take(0)).ok).toBe(true);
    expect((await bucket.check(6.4)).ok).toBe(true);
    expectNear(retryAfterOf(await bucket.check(7)), 500);
    const unseen = bucketOf('skew-zero-unseen', { capacity: 10, refillPerSecond: 1 });
    expect((await unseen.take(0)).ok).toBe(true);
    expect((await unseen.check(10)).ok).toBe(true);
  });
}
