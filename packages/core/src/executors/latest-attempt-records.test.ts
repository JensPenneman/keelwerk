import { describe, expect, test } from 'vitest';
import type { StreamRecord } from '../storage/stream-record.ts';
import type { Unit } from '../storage/unit.ts';
import { abandonOnLostLease } from './abandon-on-lost-lease.ts';
import { attemptRecordBound } from './attempt-record-bound.ts';
import { latestAttemptRecords } from './latest-attempt-records.ts';

/** A unit whose stream holds a start and an end record for attempts 1 to `ended`, then a start record of attempt `ended + 1`; it counts its calls. */
function stream(ended: number) {
  const all: StreamRecord[] = [];
  for (let attempt = 1; attempt <= ended; attempt += 1) {
    const base = { process: 'p', build: 'b', attempt, startedAt: 't' };
    all.push({ seq: BigInt(all.length + 1), data: base } as unknown as StreamRecord);
    all.push({
      seq: BigInt(all.length + 1),
      data: { ...base, endedAt: 'u' },
    } as unknown as StreamRecord);
  }
  all.push({
    seq: BigInt(all.length + 1),
    data: { process: 'p', build: 'b', attempt: ended + 1, startedAt: 't' },
  } as unknown as StreamRecord);
  const calls = { read: 0, readLast: [] as number[] };
  const unit = {
    streams: {
      read: (_stream: string, _key: string, after: bigint | null, limit: number) => {
        calls.read += 1;
        return Promise.resolve(all.filter((record) => record.seq > (after ?? 0n)).slice(0, limit));
      },
      readLast: (_stream: string, _key: string, limit: number) => {
        calls.readLast.push(limit);
        return Promise.resolve(all.slice(-limit));
      },
    },
  } as unknown as Unit;
  return { unit, calls, count: all.length };
}

describe('latestAttemptRecords', () => {
  test('an effect with 5,000 attempt records is judged from one tail read', async () => {
    const { unit, calls, count } = stream(2500);
    expect(count).toBeGreaterThan(5000);
    const { records } = await latestAttemptRecords(unit, 'e1');
    expect(calls).toEqual({ read: 0, readLast: [attemptRecordBound] });
    expect(records).toHaveLength(attemptRecordBound);
  });

  test('an open take behind 5,000 closed records is found, and attempts is the highest attempt number', async () => {
    const { unit } = stream(2500);
    const { records, attempts } = await latestAttemptRecords(unit, 'e1');
    expect(attempts).toBe(2501);
    expect(abandonOnLostLease(records, 2502).open).toBe(2501);
  });

  test('attempts is not the number of distinct attempts: a number spent with no start is not counted, one that started after it is', async () => {
    const unit = {
      streams: {
        readLast: () =>
          Promise.resolve([
            { seq: 1n, data: { attempt: 1, startedAt: 't' } },
            { seq: 2n, data: { attempt: 4, startedAt: 't' } },
          ]),
      },
    } as unknown as Unit;
    expect((await latestAttemptRecords(unit, 'e1')).attempts).toBe(4);
  });

  test('records that are no attempt records are skipped', async () => {
    const unit = {
      streams: {
        readLast: () =>
          Promise.resolve([
            { seq: 1n, data: 'x' },
            { seq: 2n, data: null },
          ]),
      },
    } as unknown as Unit;
    expect(await latestAttemptRecords(unit, 'e1')).toEqual({ records: [], attempts: 0 });
  });
});
