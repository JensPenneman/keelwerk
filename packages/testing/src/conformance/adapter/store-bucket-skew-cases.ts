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
  // Seven of the eight cases move the clock back to give two processes clocks that differ. A
  // subject whose clock ignores a negative value would fail every bound of those seven with
  // numbers; it is refused here, once per such case, with one message that says what the clock must
  // do. The move is undone at once and an hour is more than any machine takes between the two
  // readings.
  const movesBack = (clock: NonNullable<ConformanceSubject['clock']>) => {
    const hour = 3_600_000;
    const before = clock.now().epochMilliseconds;
    clock.advance(-hour);
    const after = clock.now().epochMilliseconds;
    clock.advance(hour);
    if (after >= before) {
      throw new Error(
        'The conformance clock of this target ignored advance(-3600000). The bucket store cases ' +
          'move the clock back to give two processes clocks that differ: advance(milliseconds) ' +
          'must move the clock back for a negative number as it moves it forward for a positive one.',
      );
    }
  };
  // The targets' clocks keep real time between the moves a case makes, so every real second that
  // passes credits `refillPerSecond` tokens beyond what the case moves the clock by. A case reads
  // the target's clock before its first call and again after its last call has returned; what it
  // reads, less the milliseconds it moved the clock by, is the real time from before the first call
  // to after the last, and no more real time than that can have been credited. Every reading and
  // every store compares whole milliseconds (a store keeps its row's time to the millisecond,
  // rounded down), so the bounds below hold exactly, whatever the speed of the machine.
  const timed = (direction: 'back' | 'forward') => {
    const clock = clockOf();
    if (direction === 'back') movesBack(clock);
    const began = clock.now().epochMilliseconds;
    let moved = 0;
    return {
      move: (milliseconds: number) => {
        clock.advance(milliseconds);
        moved += milliseconds;
      },
      /** The real seconds from the reading at the start to now. */
      real: () => (clock.now().epochMilliseconds - began - moved) / 1000,
    };
  };
  /**
   * Above every bucket's capacity here: a take or a check of it is refused whatever was credited.
   */
  const beyond = 2000;
  /** The error of a sum of floating-point credits, in tokens or seconds; not a time margin. */
  const slack = 1e-6;
  const retryAfterOf = (answer: { ok: boolean; retryAfter?: number | undefined }) =>
    answer.ok ? Number.NaN : (answer.retryAfter ?? Number.NaN);

  test('a row at most 5 s ahead of a take is credited once and refill goes on', async () => {
    const bucket = bucketOf('skew-a', { capacity: 1000, refillPerSecond: 1 });
    const time = timed('back');
    await bucket.take(1000);
    // One process runs 4 s ahead of the other and they alternate while time moves on 1 s a round:
    // each second is credited once, the 4 s of skew once.
    for (let round = 0; round < 10; round += 1) {
      time.move(4000);
      await bucket.take(0);
      time.move(-4000);
      await bucket.take(0);
      time.move(1000);
    }
    // The row holds 13 tokens and the real time from the emptying take to the last take that moved
    // its time, and is 3 s ahead of the clock less the real time since that take. A refusal of
    // `beyond` therefore waits for beyond - 13 tokens and the 3 s, less the real time the calls
    // spanned: at most beyond - 10, and that less the real time at least.
    expect((await bucket.check(13)).ok).toBe(true);
    const refused = retryAfterOf(await bucket.check(beyond));
    const spanned = time.real();
    expect(refused).toBeLessThanOrEqual(beyond - 10 + slack);
    expect(refused).toBeGreaterThanOrEqual(beyond - 10 - spanned - slack);
    // With the clock 4 s on the row has been credited from its time: 14 tokens and the real time
    // from the emptying take to this check.
    time.move(4000);
    expect((await bucket.check(14)).ok).toBe(true);
    const later = retryAfterOf(await bucket.check(beyond));
    const spannedLater = time.real();
    expect(later).toBeLessThanOrEqual(beyond - 14 + slack);
    expect(later).toBeGreaterThanOrEqual(beyond - 14 - spannedLater - slack);
  });

  test('two clocks 4 s apart that alternate without time moving admit the skew once', async () => {
    const bucket = bucketOf('skew-alternate', { capacity: 1000, refillPerSecond: 1 });
    const time = timed('back');
    await bucket.take(1000);
    let admitted = 0;
    for (let pair = 0; pair < 30; pair += 1) {
      time.move(4000);
      if ((await bucket.take(1)).ok) admitted += 1;
      time.move(-4000);
      if ((await bucket.take(1)).ok) admitted += 1;
    }
    const spanned = time.real();
    // 4 tokens for the skew once, and at most the real time the calls spanned on top.
    expect(admitted).toBeGreaterThanOrEqual(4);
    expect(admitted).toBeLessThanOrEqual(Math.floor(4 + spanned + slack));
  });

  test('two clocks 4 s apart over 20 rounds admit the refill of the elapsed time', async () => {
    const bucket = bucketOf('skew-window', { capacity: 1000, refillPerSecond: 1 });
    const time = timed('back');
    await bucket.take(1000);
    let admitted = 0;
    for (let round = 0; round < 20; round += 1) {
      time.move(4000);
      admitted += await bucket.drain();
      time.move(-4000);
      admitted += await bucket.drain();
      time.move(10_000);
    }
    const spanned = time.real();
    // The leading clock read 4 + 19 x 10 s after the bucket was emptied: at least 194 tokens were
    // credited (a sum of floats may fall short of the exact 194 by a rounding and so admit 193) and
    // less than one is left unspent; the real time the calls spanned is credited on top.
    expect(admitted).toBeGreaterThanOrEqual(193);
    expect(admitted).toBeLessThanOrEqual(Math.floor(194 + spanned + slack));
  });

  test('a row 3 s ahead is refused with a retryAfter that adds the 3 s', async () => {
    const bucket = bucketOf('skew-retry', { capacity: 1000, refillPerSecond: 1 });
    const time = timed('back');
    await bucket.take(1000);
    time.move(3000);
    expect((await bucket.take(3)).ok).toBe(true);
    time.move(-3000);
    const refused = [await bucket.take(beyond), await bucket.check(beyond)];
    const spanned = time.real();
    for (const answer of refused) {
      // The row holds the real time from the emptying take to the take of 3 as tokens and is 3 s
      // ahead of the clock less the real time since: the refusal waits for beyond tokens and the
      // 3 s, less the real time the calls spanned.
      expect(retryAfterOf(answer)).toBeLessThanOrEqual(beyond + 3 + slack);
      expect(retryAfterOf(answer)).toBeGreaterThanOrEqual(beyond + 3 - spanned - slack);
    }
  });

  test('a row 10 s ahead is further than the skew a store keeps: it is dated at the take and a refusal adds none of the 10 s', async () => {
    const bucket = bucketOf('skew-ten', { capacity: 10, refillPerSecond: 1 });
    const time = timed('back');
    await bucket.take(10);
    time.move(10_000);
    expect((await bucket.take(10)).ok).toBe(true);
    time.move(-10_000);
    // The row holds 0 tokens and is dated 10 s ahead of the clock, less the real time since the
    // take (a case takes milliseconds, and vitest ends it after 5 s). A row that far ahead is
    // dated at the take: the next token is 1 s away, not 11.
    expect(retryAfterOf(await bucket.check(1))).toBeCloseTo(1, 3);
    expect((await bucket.take(1)).ok).toBe(false);
    time.move(2000);
    expect((await bucket.take(2)).ok).toBe(true);
  });

  test('a row more than 5 s ahead is a clock jump and refills again from the take', async () => {
    const bucket = bucketOf('skew-jump', { capacity: 10, refillPerSecond: 1 });
    const time = timed('back');
    await bucket.take(10);
    time.move(3_600_000);
    expect((await bucket.take(10)).ok).toBe(true);
    time.move(-3_600_000);
    // a check writes nothing and the row held 0 tokens at the take: no real seconds are credited
    expect(retryAfterOf(await bucket.check(1))).toBeCloseTo(1, 3);
    expect((await bucket.take(1)).ok).toBe(false);
    time.move(2000);
    expect((await bucket.take(2)).ok).toBe(true);
  });

  test('a clock that jumped 30 minutes ahead and took the whole bucket freezes it only until the next take', async () => {
    const bucket = bucketOf('skew-freeze', { capacity: 1000, refillPerSecond: 1 });
    const time = timed('back');
    await bucket.take(1000);
    time.move(1_800_000);
    expect((await bucket.take(1000)).ok).toBe(true);
    time.move(-1_800_000);
    const results: boolean[] = [];
    for (let at = 0; at < 20; at += 1) {
      results.push((await bucket.take(1)).ok);
      time.move(1000);
    }
    // The first take finds the row 30 minutes ahead and dates it at the take, with no token; each
    // of the 19 that follow comes at least a second later and is credited a token.
    expect(results[0]).toBe(false);
    expect(results.filter(Boolean)).toHaveLength(19);
  });

  test('a take of cost 0 changes no token count', async () => {
    // A token takes 1,000 s to refill: the 6 tokens the bucket holds after the first take gain the
    // real time the calls spanned on top of the moves, and a refusal waits for what is missing.
    const bucket = bucketOf('skew-zero', { capacity: 10, refillPerSecond: 0.001 });
    const time = timed('forward');
    expect((await bucket.take(4)).ok).toBe(true);
    expect((await bucket.take(0)).ok).toBe(true);
    expect((await bucket.check(6)).ok).toBe(true);
    const first = retryAfterOf(await bucket.check(7));
    const spanned = time.real();
    expect(first).toBeLessThanOrEqual(1000 + slack);
    expect(first).toBeGreaterThanOrEqual(1000 - spanned - slack);
    time.move(500_000);
    expect((await bucket.take(0)).ok).toBe(true);
    expect((await bucket.check(6.4)).ok).toBe(true);
    const second = retryAfterOf(await bucket.check(7));
    const spannedLater = time.real();
    expect(second).toBeLessThanOrEqual(500 + slack);
    expect(second).toBeGreaterThanOrEqual(500 - spannedLater - slack);
    const unseen = bucketOf('skew-zero-unseen', { capacity: 10, refillPerSecond: 1 });
    expect((await unseen.take(0)).ok).toBe(true);
    expect((await unseen.check(10)).ok).toBe(true);
  });
}
