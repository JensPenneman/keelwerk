import { describe, expect, test } from 'vitest';
import type { StreamRecord } from '../storage/stream-record.ts';
import type { Unit } from '../storage/unit.ts';
import { abandonOnLostLease } from './abandon-on-lost-lease.ts';
import { latestAttemptRecords } from './latest-attempt-records.ts';

/** A unit whose stream holds a start and an end record for attempts 1 to `ended`, then a start record of attempt `ended + 1`. */
function stream(ended: number): { readonly unit: Unit; readonly reads: number[] } {
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
  const reads: number[] = [];
  const unit = {
    streams: {
      read: (_stream: string, _key: string, after: bigint | null, limit: number) => {
        reads.push(limit);
        return Promise.resolve(all.filter((record) => record.seq > (after ?? 0n)).slice(0, limit));
      },
    },
  } as unknown as Unit;
  return { unit, reads };
}

describe('latestAttemptRecords', () => {
  test('with more records than the bound, the latest ones are kept and the open attempt at the end is found', async () => {
    const { unit } = stream(30);
    const { records, started } = await latestAttemptRecords(unit, 'e1', 10, 7);
    expect(records).toHaveLength(10);
    expect(started.size).toBe(31);
    expect(abandonOnLostLease(records, 32).open).toBe(31);
  });

  test('a stream longer than one page is read to its end, never cut at its head', async () => {
    const { unit, reads } = stream(30);
    const { records } = await latestAttemptRecords(unit, 'e1', 1000, 7);
    expect(records).toHaveLength(61);
    expect(reads.length).toBeGreaterThan(1);
    expect(records.at(-1)?.attempt).toBe(31);
  });

  test('records that are no attempt records are skipped', async () => {
    const unit = {
      streams: {
        read: () =>
          Promise.resolve([
            { seq: 1n, data: 'x' },
            { seq: 2n, data: null },
          ]),
      },
    } as unknown as Unit;
    expect(await latestAttemptRecords(unit, 'e1', 10)).toEqual({ records: [], started: new Set() });
  });
});
