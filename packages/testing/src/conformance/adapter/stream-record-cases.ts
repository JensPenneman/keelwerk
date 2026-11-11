import type { StorageScope } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { streamRecordExpiryCases } from './stream-record-expiry-cases.ts';
import { seqsOf } from './stream-record-seqs.ts';

const { tenantA, tenantB, backend } = conformanceScopes;
const namespaceScope: StorageScope = { level: 'namespace', reason: 'conformance' };
const stream = 'conf.log';
const other = 'conf.other';

/** The case files of 14.10 for the stream record store: serials, reads, expiry, purges, isolation (15.1.12). */
export function streamRecordCases(subject: ConformanceSubject): void {
  const clockOf = () => {
    if (subject.clock === undefined) {
      throw new Error('the stream record cases need the adapter clock');
    }
    return subject.clock;
  };

  describe('stream records (15.1.12, 14.10 case 10)', () => {
    streamRecordExpiryCases(subject);

    test('append answers the first seq; seqs rise by one per record, per stream and key', async () => {
      const first = await subject.run(tenantA, async (unit) => [
        await unit.streams.append(stream, 'a', [{ n: 1 }]),
        await unit.streams.append(stream, 'a', [{ n: 2 }, { n: 3 }]),
        await unit.streams.append(stream, 'b', [{ n: 1 }]),
        await unit.streams.append(other, 'a', [{ n: 1 }]),
      ]);
      expect(first.map((answer) => answer.firstSeq)).toEqual([1n, 2n, 1n, 1n]);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'a'))).toEqual([1n, 2n, 3n]);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'a', other))).toEqual([1n]);
    });

    test("read answers the records after a seq in order, up to the limit, at the adapter clock's instant", async () => {
      const clock = clockOf();
      clock.advance(1000);
      const beforeFirst = clock.now().epochMilliseconds;
      await subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [{ n: 1 }, { n: 2 }]));
      const afterFirst = clock.now().epochMilliseconds;
      clock.advance(5000);
      const beforeSecond = clock.now().epochMilliseconds;
      await subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [{ n: 3 }, { n: 4 }]));
      const afterSecond = clock.now().epochMilliseconds;
      const all = await subject.read(tenantA, (unit) => unit.streams.read(stream, 'k', null, 10));
      expect(all.map((r) => [r.seq, r.data])).toEqual([
        [1n, { n: 1 }],
        [2n, { n: 2 }],
        [3n, { n: 3 }],
        [4n, { n: 4 }],
      ]);
      const [one, two, three, four] = all.map((r) => r.at.epochMilliseconds);
      expect(one).toBe(two);
      expect(three).toBe(four);
      expect(one).toBeGreaterThanOrEqual(beforeFirst);
      expect(one).toBeLessThanOrEqual(afterFirst);
      expect(three).toBeGreaterThanOrEqual(beforeSecond);
      expect(three).toBeLessThanOrEqual(afterSecond);
      const after = await subject.read(tenantA, (unit) => unit.streams.read(stream, 'k', 1n, 2));
      expect(after.map((r) => r.seq)).toEqual([2n, 3n]);
      expect(await subject.read(tenantA, (unit) => unit.streams.read(stream, 'k', 4n, 10))).toEqual(
        [],
      );
      expect(
        await subject.read(tenantA, (unit) => unit.streams.read(stream, 'none', null, 10)),
      ).toEqual([]);
    });

    test('a rolled-back unit appends nothing and gives its seqs back', async () => {
      await subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [{ n: 1 }]));
      await subject
        .run(tenantA, async (unit) => {
          await unit.streams.append(stream, 'k', [{ n: 2 }, { n: 3 }, { n: 4 }]);
          throw new Error('boom');
        })
        .catch(() => undefined);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'k'))).toEqual([1n]);
      const next = await subject.run(tenantA, (unit) =>
        unit.streams.append(stream, 'k', [{ n: 5 }]),
      );
      expect(next.firstSeq).toBe(2n);
    });

    test('concurrent appends to one key take consecutive seqs per batch, in commit order', async () => {
      const count = subject.networked ? 20 : 10;
      const taken = new Map<number, bigint>();
      const unitOf = (index: number, hold?: Promise<void>, entered?: () => void) =>
        subject.run(tenantA, async (unit) => {
          const answer = await unit.streams.append(stream, 'box', [{ n: index }, { n: index }]);
          taken.set(index, answer.firstSeq);
          await unit.events.append([appendOf(1 + index, [1])]);
          entered?.();
          await hold;
        });
      // The first unit has appended and stays open; only then do the others start, so every
      // one of them meets a counter another unit holds.
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const first = unitOf(0, release.promise, entered.resolve);
      await entered.promise;
      const others = Array.from({ length: count - 1 }, (_, n) => unitOf(n + 1));
      release.resolve();
      await Promise.all([first, ...others]);
      const records = await subject.read(tenantA, (unit) =>
        unit.streams.read(stream, 'box', null, count * 2 + 10),
      );
      expect(records.map((r) => r.seq)).toEqual(
        Array.from({ length: count * 2 }, (_, n) => BigInt(n + 1)),
      );
      for (const [index, firstSeq] of taken) {
        const batch = records.filter((r) => (r.data as { n: number }).n === index);
        expect(batch.map((r) => r.seq)).toEqual([firstSeq, firstSeq + 1n]);
      }
      expect(taken.get(0)).toBe(1n);
      const log = await subject.read(tenantA, (unit) =>
        unit.events.readAll(null, { limit: count + 10 }),
      );
      const inCommitOrder = log.events.map((event) => {
        const index = Array.from(taken.keys()).find(
          (candidate) => conformanceId(1 + candidate) === event.stream.id,
        );
        return index === undefined ? undefined : taken.get(index);
      });
      // The unit that took a counter first commits first: the log lists the batches by their seqs.
      expect(inCommitOrder).toEqual(
        [...taken.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    });

    test('purgeKeys removes every record of the keys and answers the count; seqs continue after a purge', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.streams.append(stream, 'a', [{ n: 1 }, { n: 2 }]);
        await unit.streams.append(stream, 'b', [{ n: 1 }]);
        await unit.streams.append(stream, 'c', [{ n: 1 }]);
      });
      expect(await subject.run(tenantA, (unit) => unit.streams.purgeKeys(stream, []))).toBe(0);
      expect(
        await subject.run(tenantA, (unit) => unit.streams.purgeKeys(stream, ['a', 'c', 'none'])),
      ).toBe(3);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'a'))).toEqual([]);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'b'))).toEqual([1n]);
      const next = await subject.run(tenantA, (unit) =>
        unit.streams.append(stream, 'a', [{ n: 3 }]),
      );
      expect(next.firstSeq).toBe(3n);
    });

    test('a record keeps its JSON; an empty batch and a record holding U+0000 or a lone surrogate are refused', async () => {
      const record = {
        text: 'héllo "quoted" \\u0000 back\\slash',
        list: [1, 2.5, null, true, { deep: ['x'] }],
        empty: {},
        zero: 0,
      };
      await subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [record, 'plain', 7]));
      const stored = await subject.read(tenantA, (unit) =>
        unit.streams.read(stream, 'k', null, 10),
      );
      expect(stored.map((r) => r.data)).toEqual([record, 'plain', 7]);
      const refused = { kind: 'validation', code: 'core.malformed_request' };
      expect(
        await failureOf(subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', []))),
      ).toEqual(refused);
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [{ text: 'a\u0000b' }])),
        ),
      ).toEqual(refused);
      for (const text of ['ab\ud83d', '\ude00ab']) {
        expect(
          await failureOf(
            subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [{ text }])),
          ),
        ).toEqual(refused);
      }
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [{ 'k\ud800': 1 }])),
        ),
      ).toEqual(refused);
      // A well-formed pair and text that merely looks like an escape are kept.
      await subject.run(tenantA, (unit) =>
        unit.streams.append(stream, 'k', [{ text: 'a\u{1f600}b \\ud83d' }]),
      );
      expect(
        (await subject.read(tenantA, (unit) => unit.streams.read(stream, 'k', 3n, 10))).map(
          (r) => r.data,
        ),
      ).toEqual([{ text: 'a\u{1f600}b \\ud83d' }]);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'k'))).toEqual([1n, 2n, 3n, 4n]);
    });

    test('a read-only unit cannot append, expire or purge; a namespace-scope unit is refused', async () => {
      const internal = { kind: 'internal', code: 'core.internal' };
      expect(
        await failureOf(subject.read(tenantA, (unit) => unit.streams.append(stream, 'k', [{}]))),
      ).toEqual(internal);
      expect(
        await failureOf(
          subject.read(tenantA, (unit) => unit.streams.expire(stream, { maxPerKey: 1 }, 1)),
        ),
      ).toEqual(internal);
      expect(
        await failureOf(subject.read(tenantA, (unit) => unit.streams.purgeKeys(stream, ['k']))),
      ).toEqual(internal);
      const forbidden = { kind: 'forbidden', code: 'core.forbidden' };
      expect(
        await failureOf(
          subject.run(namespaceScope, (unit) => unit.streams.append(stream, 'k', [{}])),
        ),
      ).toEqual(forbidden);
      expect(
        await failureOf(
          subject.run(namespaceScope, (unit) => unit.streams.read(stream, 'k', null, 1)),
        ),
      ).toEqual(forbidden);
      expect(
        await failureOf(
          subject.run(namespaceScope, (unit) => unit.streams.expire(stream, { maxPerKey: 1 }, 1)),
        ),
      ).toEqual(forbidden);
      expect(
        await failureOf(subject.run(namespaceScope, (unit) => unit.streams.purgeKeys(stream, []))),
      ).toEqual(forbidden);
    });
  });

  describe('stream records, isolation (14.10 case 5)', () => {
    test('a tenant reads, expires and purges only its own records', async () => {
      await subject.run(tenantA, (unit) => unit.streams.append(stream, 'k', [{ n: 1 }, { n: 2 }]));
      await subject.run(tenantB, (unit) => unit.streams.append(stream, 'k', [{ n: 9 }]));
      await subject.run(backend, (unit) => unit.streams.append(stream, 'k', [{ n: 7 }]));
      expect(
        (await subject.read(tenantB, (unit) => unit.streams.read(stream, 'k', null, 10))).map(
          (r) => r.data,
        ),
      ).toEqual([{ n: 9 }]);
      expect(
        await subject.run(tenantA, (unit) => unit.streams.expire(stream, { maxPerKey: 1 }, 10)),
      ).toBe(1);
      expect(await subject.read(tenantB, (unit) => seqsOf(unit, 'k'))).toEqual([1n]);
      expect(await subject.run(tenantB, (unit) => unit.streams.purgeKeys(stream, ['k']))).toBe(1);
      expect(await subject.read(tenantA, (unit) => seqsOf(unit, 'k'))).toEqual([2n]);
      expect(
        (await subject.read(backend, (unit) => unit.streams.read(stream, 'k', null, 10))).map(
          (r) => r.data,
        ),
      ).toEqual([{ n: 7 }]);
    });

    test('each scope has its own seqs for a key', async () => {
      const firsts = [];
      for (const scope of [tenantA, tenantB, backend]) {
        await subject.run(scope, (unit) => unit.streams.append(stream, 'k', [{ n: 1 }, { n: 2 }]));
        firsts.push(
          (await subject.run(scope, (unit) => unit.streams.append(stream, 'k', [{ n: 3 }])))
            .firstSeq,
        );
      }
      expect(firsts).toEqual([3n, 3n, 3n]);
    });
  });
}
