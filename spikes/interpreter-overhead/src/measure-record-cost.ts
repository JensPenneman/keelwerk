import { chainHash } from '@keelwerk/core';
import { loadCounts } from './load-counts.ts';
import type { RecordCost } from './record-cost.ts';
import { summaryOf } from './summary-of.ts';

/** The record's shape as `buildDecisionRecord` of the core makes it; the function is not exported, so the loop is repeated here. */
function buildRecord(
  reads: readonly { readonly at: bigint }[],
  answers: readonly { kind: 'id'; entity: string; value: string }[],
) {
  return {
    part: 'bench.generatorUnbatched',
    inputDigest: 'f'.repeat(64),
    reads: reads.map((read) => ({ at: read.at })),
    answers: answers.map((answer) => ({ ...answer })),
    effects: [] as string[],
  };
}

function hashOf(decision: ReturnType<typeof buildRecord>): string {
  return chainHash(null, {
    eventId: '0198a1e0-0000-7000-8000-000000000001',
    streamId: '0198a1e0-0000-7000-8000-000000000002',
    version: 2,
    name: 'changed',
    schemaVersion: 1,
    data: { set: { hits: 1 } },
    before: { hits: 0 },
    hlc: '019a5d9f4c000000-sbaseline000',
    recordedAt: Temporal.Instant.from('2026-11-05T10:00:00Z'),
    actor: { kind: 'user', id: 'ada', via: 'test' },
    writer: { build: 'spike', revision: 1 },
    flags: [],
    decision,
    commandId: '0198a1e0-0000-7000-8000-000000000003',
    client: null,
  });
}

/** Measures the build and the hash of the decision record for 0, 1, 5 and 20 loads, over alternating rounds. */
export function measureRecordCost(iterations: number, rounds: number): readonly RecordCost[] {
  // Every built record and every hash is counted, so the engine cannot skip the work.
  let consumed = 0;
  const microseconds = (work: () => number): number => {
    const start = performance.now();
    for (let count = 0; count < iterations; count += 1) consumed += work();
    return ((performance.now() - start) * 1000) / iterations;
  };
  const sizeOf = (record: ReturnType<typeof buildRecord>): number =>
    record.reads.length + record.answers.length + record.effects.length + 1;
  const make = (loads: number) => ({
    reads: Array.from({ length: loads }, (_, index) => ({ at: BigInt(1000 + index) })),
    answers: [
      { kind: 'id' as const, entity: 'bench.item', value: '0198a1e0-0000-7000-8000-000000000009' },
    ],
  });
  const empty = buildRecord([], []);
  const built = new Map<number, number[]>();
  const hashed = new Map<number, number[]>();
  for (let round = 0; round < rounds; round += 1) {
    const order = round % 2 === 0 ? loadCounts : [...loadCounts].reverse();
    const base = microseconds(() => hashOf(empty).length);
    for (const loads of order) {
      const { reads, answers } = make(loads);
      const record = buildRecord(reads, answers);
      built.set(loads, [
        ...(built.get(loads) ?? []),
        microseconds(() => sizeOf(buildRecord(reads, answers))),
      ]);
      hashed.set(loads, [
        ...(hashed.get(loads) ?? []),
        microseconds(() => hashOf(record).length) - base,
      ]);
    }
  }
  if (consumed <= 0) throw new Error('the decision records were not built');
  return loadCounts.map((loads) => ({
    loads,
    build: summaryOf(built.get(loads) ?? []),
    hash: summaryOf(hashed.get(loads) ?? []),
  }));
}
