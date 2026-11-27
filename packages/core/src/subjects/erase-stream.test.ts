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
    const result = await eraseStream(unit, {
      registry,
      stream,
      record,
      writer,
      now,
      nominated: true,
    });
    expect(calls).toEqual(['findOne:lock:true', 'readStream']);
    expect(result).toEqual({ outcome: 'replayed', owned: true, valueKeys: [] });
  });

  test('an erased tombstone with no erased event of this erasure is not erased again, and no subject owns it', async () => {
    const { unit, calls } = setup({ id: stream.id, kwErasedAt: now }, []);
    const result = await eraseStream(unit, {
      registry,
      stream,
      record,
      writer,
      now,
      nominated: true,
    });
    expect(calls).toEqual(['findOne:lock:true', 'readStream']);
    expect(result).toEqual({ outcome: 'skipped', owned: true, valueKeys: [] });
  });

  test('a row that nobody owns is the subject’s only when the erasure found it as the subject’s', async () => {
    const { unit } = setup({ id: stream.id, kwErasedAt: now }, []);
    const input = { registry, stream, record, writer, now };
    expect(await eraseStream(unit, { ...input, nominated: true })).toMatchObject({ owned: true });
    expect(await eraseStream(unit, { ...input, nominated: false })).toMatchObject({ owned: false });
  });

  test('an earlier answer that treated the row as a mere holder is not replayed for a nominated visit', async () => {
    const holderAnswer = {
      type: 'x.thing.erased',
      data: { subjectId, fields: ['n'], owned: false },
    };
    const input = { registry, stream, record, writer, now };
    // The row is the subject's now (and erased, so the unit stops after deciding): the answer is read again.
    const hers = setup({ id: stream.id, owner: subjectId, kwErasedAt: now }, [holderAnswer]);
    expect(await eraseStream(hers.unit, { ...input, nominated: true })).toMatchObject({
      outcome: 'skipped',
      owned: true,
    });
    // Control: a visit that did not nominate the row, or a row another subject owns, replays the answer.
    const plain = setup({ id: stream.id, owner: subjectId }, [holderAnswer]);
    expect(await eraseStream(plain.unit, { ...input, nominated: false })).toEqual({
      outcome: 'replayed',
      owned: false,
      valueKeys: [],
    });
    const another = setup({ id: stream.id, owner: '0192f3a0-0000-7000-8000-0000000000a2' }, [
      holderAnswer,
    ]);
    expect(await eraseStream(another.unit, { ...input, nominated: true })).toMatchObject({
      outcome: 'replayed',
      owned: false,
    });
  });

  test('a row that is gone is skipped', async () => {
    const { unit } = setup(undefined, []);
    expect(
      await eraseStream(unit, { registry, stream, record, writer, now, nominated: true }),
    ).toMatchObject({
      outcome: 'skipped',
    });
  });
});
