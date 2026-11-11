import type { StreamRef, WireError } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { ConsumerKit } from './consumer-kit.ts';
import { failureOf } from './failure-of.ts';

const { tenantA } = conformanceScopes;
const consumer = 'consumer.one';
const other = 'consumer.two';

const streamOf = (n: number): StreamRef => ({ type: 'library.book', id: conformanceId(n) });
const errorOf = (code: string): WireError => ({
  kind: 'internal',
  code,
  message: 'a personal value: ada@example.org',
  retryable: false,
  requestId: 'request-1',
});

/** The row of a parked stream: moving its start on keeps what says how often and since when it is parked. */
export function consumerParkedCases(
  kit: ConsumerKit,
  subject: Pick<ConformanceSubject, 'read'>,
): void {
  const { clock, inA, inB, inNs } = kit;

  test('advanceParked moves the start of a parked row forward and keeps its attempts, parked_at and error', async () => {
    await inA((unit) => unit.consumers.park(consumer, streamOf(1), 10n, errorOf('core.internal')));
    await inA((unit) => unit.consumers.park(consumer, streamOf(1), 20n, errorOf('core.timeout_x')));
    const [before] = await inA((unit) => unit.consumers.parked(consumer));
    expect(before).toMatchObject({
      from: 10n,
      attempts: 2,
      lastError: { code: 'core.internal' },
    });
    clock().advance(500);
    expect(await inA((unit) => unit.consumers.advanceParked(consumer, streamOf(1), 15n))).toBe(
      true,
    );
    let [row] = await inA((unit) => unit.consumers.parked(consumer));
    expect(row).toMatchObject({ from: 15n, attempts: 2, lastError: { code: 'core.internal' } });
    expect(row?.parkedAt.epochMilliseconds).toBe(before?.parkedAt.epochMilliseconds);
    // Never backward.
    expect(await inA((unit) => unit.consumers.advanceParked(consumer, streamOf(1), 3n))).toBe(true);
    [row] = await inA((unit) => unit.consumers.parked(consumer));
    expect(row?.from).toBe(15n);
    // Another stream, another consumer, another scope and an unparked stream are not touched.
    await inA((unit) => unit.consumers.park(other, streamOf(1), 4n, errorOf('core.internal')));
    expect(await inA((unit) => unit.consumers.advanceParked(other, streamOf(2), 9n))).toBe(false);
    expect(await inB((unit) => unit.consumers.advanceParked(consumer, streamOf(1), 9n))).toBe(
      false,
    );
    expect((await inA((unit) => unit.consumers.parked(other)))[0]?.from).toBe(4n);
    expect(await inA((unit) => unit.consumers.unpark(consumer, streamOf(1)))).toBe(15n);
    expect(await inA((unit) => unit.consumers.advanceParked(consumer, streamOf(1), 30n))).toBe(
      false,
    );
    expect(
      await failureOf(inNs((unit) => unit.consumers.advanceParked(consumer, streamOf(1), 1n))),
    ).toEqual({ kind: 'forbidden', code: 'core.forbidden' });
    expect(
      await failureOf(
        subject.read(tenantA, (unit) => unit.consumers.advanceParked(consumer, streamOf(1), 1n)),
      ),
    ).toEqual({ kind: 'internal', code: 'core.internal' });
  });
}
