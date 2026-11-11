import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { seqsOf } from './stream-record-seqs.ts';

const { tenantA } = conformanceScopes;
const stream = 'conf.log';
const other = 'conf.other';

/** The expiry cases of the stream record store (14.7.1 `streamRecords`, 15.1.12): age, count per key, bounded batches. */
export function streamRecordExpiryCases(subject: ConformanceSubject): void {
  const clockOf = () => {
    if (subject.clock === undefined) {
      throw new Error('the stream record cases need the adapter clock');
    }
    return subject.clock;
  };

  describe('stream record expiry', () => {
    test('expire by maxAge removes records older than the age, oldest first, up to the limit', async () => {
      const clock = clockOf();
      for (const key of ['a', 'b', 'c']) {
        await subject.run(tenantA, (unit) =>
          unit.streams.append(stream, key, [{ n: 1 }, { n: 2 }]),
        );
        clock.advance(10_000);
      }
      // a is 30 s old, b 20 s, c 10 s.
      const removed = await subject.run(tenantA, (unit) =>
        unit.streams.expire(stream, { maxAge: '15s' }, 3),
      );
      expect(removed).toBe(3);
      const left = await subject.read(tenantA, async (unit) => [
        await seqsOf(unit, 'a'),
        await seqsOf(unit, 'b'),
        await seqsOf(unit, 'c'),
      ]);
      // The oldest three of the four old records went: all of a, then the first of b.
      expect(left).toEqual([[], [2n], [1n, 2n]]);
      expect(
        await subject.run(tenantA, (unit) => unit.streams.expire(stream, { maxAge: 'PT15S' }, 10)),
      ).toBe(1);
      expect(
        await subject.run(tenantA, (unit) => unit.streams.expire(stream, { maxAge: '15s' }, 10)),
      ).toBe(0);
    });

    test('expire by maxPerKey keeps the newest records of every key', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.streams.append(stream, 'a', [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
        await unit.streams.append(stream, 'b', [{ n: 1 }]);
        await unit.streams.append(other, 'a', [{ n: 1 }, { n: 2 }, { n: 3 }]);
      });
      expect(
        await subject.run(tenantA, (unit) => unit.streams.expire(stream, { maxPerKey: 2 }, 100)),
      ).toBe(2);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'a'))).toEqual([3n, 4n]);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'b'))).toEqual([1n]);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'a', other))).toEqual([1n, 2n, 3n]);
      // Both members together remove what either selects.
      clockOf().advance(60_000);
      await subject.run(tenantA, (unit) => unit.streams.append(stream, 'a', [{ n: 5 }]));
      expect(
        await subject.run(tenantA, (unit) =>
          unit.streams.expire(stream, { maxAge: '30s', maxPerKey: 5 }, 100),
        ),
      ).toBe(3);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'a'))).toEqual([5n]);
    });

    test('expire works in bounded batches over a stream of a few thousand records', async () => {
      const clock = clockOf();
      const keys = ['a', 'b', 'c', 'd'];
      const perKey = 600;
      const rows = Array.from({ length: perKey }, (_, n) => ({ n }));
      for (const key of keys) {
        await subject.run(tenantA, async (unit) => {
          await unit.streams.append(stream, key, rows);
          await unit.streams.append(other, key, rows);
        });
      }
      clock.advance(60_000);
      for (const key of keys) {
        await subject.run(tenantA, async (unit) => {
          await unit.streams.append(stream, key, [{ n: perKey }]);
          await unit.streams.append(other, key, [{ n: perKey }]);
        });
      }
      const drain = async (streamName: string, policy: { maxAge?: string; maxPerKey?: number }) => {
        const batches: number[] = [];
        for (;;) {
          const removed = await subject.run(tenantA, (unit) =>
            unit.streams.expire(streamName, policy, 1000),
          );
          batches.push(removed);
          if (removed === 0) return batches;
        }
      };
      const total = keys.length * perKey;
      expect(await drain(stream, { maxAge: '30s' })).toEqual([1000, 1000, total - 2000, 0]);
      expect(await drain(other, { maxPerKey: 1 })).toEqual([1000, 1000, total - 2000, 0]);
      for (const key of keys) {
        expect(await subject.read(tenantA, (unit) => seqsOf(unit, key))).toEqual([
          BigInt(perKey + 1),
        ]);
        expect(await subject.read(tenantA, (unit) => seqsOf(unit, key, other))).toEqual([
          BigInt(perKey + 1),
        ]);
      }
    }, 60_000);

    test('expire refuses a policy with neither member, a malformed age and a limit below one', async () => {
      const refused = { kind: 'validation', code: 'core.malformed_request' };
      expect(
        await failureOf(subject.run(tenantA, (unit) => unit.streams.expire(stream, {}, 10))),
      ).toEqual(refused);
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.streams.expire(stream, { maxAge: 'soon' }, 10)),
        ),
      ).toEqual(refused);
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.streams.expire(stream, { maxPerKey: 0 }, 10)),
        ),
      ).toEqual(refused);
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.streams.expire(stream, { maxPerKey: 1 }, 0)),
        ),
      ).toEqual(refused);
    });
  });
}
