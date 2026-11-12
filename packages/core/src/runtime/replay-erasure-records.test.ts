import { describe, expect, test } from 'vitest';
import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import { replayErasureRecords } from './replay-erasure-records.ts';

const commandId = 'erase-1';
const tenantA = '0192f3a0-0000-7000-8000-000000000001';
const tenantB = '0192f3a0-0000-7000-8000-000000000002';
const ada = '0192f3a0-0000-7000-8000-0000000000a1';
const bea = '0192f3a0-0000-7000-8000-0000000000a2';

function record(tenantId: string, subjectId: string, id = commandId): ErasureRecord {
  return {
    type: 'erasure',
    tenantId,
    subjectId,
    recordedAt: '2026-11-12T08:00:00.000Z',
    requester: { kind: 'operator', id: null, via: 'core.operator' },
    reason: 'subjectRequest',
    commandId: id,
  };
}

function contextOf(control: readonly LedgerRecord[], sink: () => AsyncGenerator<LedgerRecord>) {
  return {
    control: {
      ledger: {
        since: async (seq: bigint, limit: number) =>
          control
            .map((entry, at) => ({ seq: BigInt(at + 1), record: entry }))
            .filter((entry) => entry.seq > seq)
            .slice(0, limit),
      },
    },
    ledgers: [{ read: sink }],
  };
}

async function replayed(
  control: readonly LedgerRecord[],
  sink: readonly LedgerRecord[] = [],
): Promise<ErasureRecord[]> {
  const context = contextOf(control, async function* () {
    yield* sink;
  });
  const found: ErasureRecord[] = [];
  for await (const entry of replayErasureRecords(context as never)) found.push(entry);
  return found;
}

describe('the erasure records of the ledger union are told apart by tenant, command id and subject', () => {
  test('one command id in two tenants, and again for another subject in one, gives every record', async () => {
    const records = [record(tenantA, ada), record(tenantB, bea), record(tenantA, bea)];
    expect(await replayed(records)).toEqual(records);
  });

  test('a record the sink holds beside the control ledger comes once, in either spelling of its subject', async () => {
    const control = [record(tenantA, ada)];
    const sink = [record(tenantA, ada.replaceAll('-', '').toUpperCase()), record(tenantB, ada)];
    expect(await replayed(control, sink)).toEqual([record(tenantA, ada), record(tenantB, ada)]);
  });
});

describe('what the replay offers beside the records (one read of the ledger for every reader)', () => {
  test('the observer sees every control entry in ledger order, the records it does not pick included', async () => {
    const tombstone: LedgerRecord = {
      type: 'keyTombstone',
      scopeId: tenantA,
      keyId: 'key-1',
      recordedAt: '2026-11-12T08:00:00.000Z',
      reason: 'erasure',
    };
    const control = [record(tenantA, ada), tombstone, record(tenantB, bea)];
    const context = contextOf(control, async function* () {
      yield record(tenantA, ada);
    });
    const seen: { seq: bigint; type: string }[] = [];
    const found: ErasureRecord[] = [];
    for await (const entry of replayErasureRecords(context as never, {
      observe: ({ seq, record: observed }) => seen.push({ seq, type: observed.type }),
    })) {
      found.push(entry);
    }
    expect(seen).toEqual([
      { seq: 1n, type: 'erasure' },
      { seq: 2n, type: 'keyTombstone' },
      { seq: 3n, type: 'erasure' },
    ]);
    expect(found).toEqual([record(tenantA, ada), record(tenantB, bea)]);
  });

  test('a sink that cannot be read ends the replay, unless the caller takes the failure', async () => {
    const broken = async function* (): AsyncGenerator<LedgerRecord> {
      yield* [];
      throw new Error('the sink is down');
    };
    const context = contextOf([record(tenantA, ada)], broken);
    const drain = async (options?: Parameters<typeof replayErasureRecords>[1]) => {
      const found: ErasureRecord[] = [];
      for await (const entry of replayErasureRecords(context as never, options)) found.push(entry);
      return found;
    };
    await expect(drain()).rejects.toThrow('the sink is down');
    const failures: unknown[] = [];
    expect(await drain({ onSinkError: (cause) => failures.push(cause) })).toEqual([
      record(tenantA, ada),
    ]);
    expect(failures).toHaveLength(1);
  });
});
