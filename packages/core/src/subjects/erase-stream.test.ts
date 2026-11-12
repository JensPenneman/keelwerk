import { describe, expect, test } from 'vitest';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { eraseStream } from './erase-stream.ts';

const subjectId = '0192f3a0-0000-7000-8000-0000000000a1';
const stream = { type: 'x.thing', id: '0192f3a0-0000-7000-8000-0000000000b1' };
const record: ErasureRecord = {
  type: 'erasure',
  tenantId: '0192f3a0-0000-7000-8000-000000000001',
  subjectId,
  recordedAt: '2026-11-12T08:00:00.000Z',
  requester: { kind: 'operator', id: null, via: 'core.operator' },
  reason: 'subjectRequest',
  commandId: 'c1',
};
const registry = {
  entities: new Map([
    [
      'x.thing',
      {
        ref: 'x.thing',
        module: 'x',
        descriptor: { ref: 'x.thing', tenancy: 'tenant', dataSubject: 'owner', fields: {} },
      },
    ],
  ]),
} as unknown as Registry;
const writer = {} as RunJobContext['writer'];
const now = Temporal.Instant.from('2026-11-12T09:00:00Z');

/** A unit that records the order of the reads that decide what to do. */
function setup(row: Record<string, unknown> | undefined, events: readonly unknown[]) {
  const calls: string[] = [];
  const unit = {
    rows: {
      findOne: async (_descriptor: unknown, query: Record<string, unknown>) => {
        calls.push(`findOne:${query.forUpdate === true ? 'lock' : 'plain'}:${query.includeErased}`);
        return row;
      },
    },
    events: {
      readStream: async () => {
        calls.push('readStream');
        return events;
      },
    },
  } as unknown as Unit;
  return { unit, calls };
}

const erasedEvent = { type: 'x.thing.erased', data: { subjectId, fields: [], owned: true } };

describe('eraseStream decides after the row lock', () => {
  test('locks the row first (erased rows included), then looks for an erased event of this erasure', async () => {
    const { unit, calls } = setup({ id: stream.id }, [erasedEvent]);
    const result = await eraseStream(unit, { registry, stream, record, writer, now });
    expect(calls).toEqual(['findOne:lock:true', 'readStream']);
    expect(result).toEqual({ outcome: 'replayed', owned: true, valueKeys: [] });
  });

  test('an erased tombstone with no erased event of this erasure is left alone', async () => {
    const { unit, calls } = setup({ id: stream.id, kwErasedAt: now }, []);
    const result = await eraseStream(unit, { registry, stream, record, writer, now });
    expect(calls).toEqual(['findOne:lock:true', 'readStream']);
    expect(result).toEqual({ outcome: 'skipped', owned: false, valueKeys: [] });
  });

  test('a row that is gone is skipped', async () => {
    const { unit } = setup(undefined, []);
    expect(await eraseStream(unit, { registry, stream, record, writer, now })).toMatchObject({
      outcome: 'skipped',
    });
  });
});
