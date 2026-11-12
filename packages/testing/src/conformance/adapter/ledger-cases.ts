import type {
  ControlLedger,
  ErasureCompletedRecord,
  ErasureRecord,
  KeyTombstoneRecord,
  NamespaceRef,
  StorageScope,
  Unit,
} from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { beforeEach, describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';

const { tenantA, backend, deployment } = conformanceScopes;

function erasure(n: number): ErasureRecord {
  return {
    type: 'erasure',
    tenantId: '00000000-0000-4000-8000-0000000000a1',
    subjectId: `00000000-0000-4000-8000-00000000f${String(n).padStart(3, '0')}`,
    recordedAt: '2026-11-11T10:00:00.000Z',
    requester: { kind: 'operator', id: null, via: 'core.operator' },
    reason: 'subjectRequest',
    commandId: `00000000-0000-4000-8000-00000000e${String(n).padStart(3, '0')}`,
  };
}

function ledgerOf(unit: Unit): ControlLedger {
  if (unit.ledger === undefined) throw new Error('the deployment unit has no ledger');
  return unit.ledger;
}

const completion: ErasureCompletedRecord = {
  type: 'erasureCompleted',
  tenantId: '00000000-0000-4000-8000-0000000000a1',
  commandId: '00000000-0000-4000-8000-00000000e001',
  subjectId: '00000000-0000-4000-8000-00000000f001',
  epoch: 0,
  recordedAt: '2026-11-11T10:00:02.000Z',
};

const tombstone: KeyTombstoneRecord = {
  type: 'keyTombstone',
  scopeId: '00000000-0000-4000-8000-0000000000a1',
  keyId: 'key-1',
  recordedAt: '2026-11-11T10:00:01.000Z',
  reason: 'erasure',
};

/**
 * The deployment's ledger store: `kw_ledger` (S-125) lives in the control store's root only, so the
 * cases run in a namespace of that root, provisioned here beside the subject's own.
 */
export function ledgerCases(subject: ConformanceSubject): void {
  describe('ledger (14.7.5)', () => {
    const control = (): NamespaceRef => ({
      ...subject.namespace(),
      id: 'ns-conformance-control',
      root: 'kw__control',
    });
    const inControl = <T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>, readOnly = false) =>
      subject.adapter().unit(control(), scope, fn, readOnly ? { readOnly } : {});
    const run = <T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>) => inControl(scope, fn);
    const read = <T>(scope: StorageScope, fn: (unit: Unit) => Promise<T>) =>
      inControl(scope, fn, true);
    beforeEach(async () => {
      await subject.adapter().schema.provision(control(), []);
    });

    test('append answers rising seqs and since returns the records after a seq, in order', async () => {
      const first = await run(deployment, (unit) => ledgerOf(unit).append(erasure(1)));
      const second = await run(deployment, (unit) => ledgerOf(unit).append(tombstone));
      const third = await run(deployment, (unit) => ledgerOf(unit).append(erasure(2)));
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error('the deployment unit has no ledger');
      }
      expect(second).toBeGreaterThan(first);
      expect(third).toBeGreaterThan(second);
      const found = await read(deployment, async (unit) => ledgerOf(unit).since(first - 1n, 10));
      expect(found?.map((entry) => entry.seq)).toEqual([first, second, third]);
      expect(found?.map((entry) => entry.record)).toEqual([erasure(1), tombstone, erasure(2)]);
    });

    test('an erasure completion round-trips through since, after its erasure record', async () => {
      const first = await run(deployment, (unit) => ledgerOf(unit).append(erasure(1)));
      const second = await run(deployment, (unit) => ledgerOf(unit).append(completion));
      if (first === undefined || second === undefined) {
        throw new Error('the deployment unit has no ledger');
      }
      expect(second).toBeGreaterThan(first);
      const found = await read(deployment, async (unit) => ledgerOf(unit).since(first - 1n, 10));
      expect(found?.map((entry) => entry.record)).toEqual([erasure(1), completion]);
    });

    test('since pages by the limit', async () => {
      const seqs: bigint[] = [];
      for (let n = 10; n < 15; n += 1) {
        const seq = await run(deployment, (unit) => ledgerOf(unit).append(erasure(n)));
        if (seq === undefined) throw new Error('the deployment unit has no ledger');
        seqs.push(seq);
      }
      const [head, ...rest] = seqs;
      if (head === undefined) throw new Error('no seqs');
      const page = await read(deployment, async (unit) => ledgerOf(unit).since(head - 1n, 2));
      expect(page?.map((entry) => entry.seq)).toEqual([head, rest[0]]);
      const next = await read(deployment, async (unit) =>
        ledgerOf(unit).since(page?.at(-1)?.seq ?? 0n, 10),
      );
      expect(next?.map((entry) => entry.seq)).toEqual(rest.slice(1));
    });

    test('tenant and backend units have no ledger', async () => {
      expect(await run(tenantA, async (unit) => unit.ledger === undefined)).toBe(true);
      expect(await run(backend, async (unit) => unit.ledger === undefined)).toBe(true);
      expect(await run(deployment, async (unit) => unit.ledger !== undefined)).toBe(true);
    });

    test('a read-only unit appends nothing', async () => {
      await expect(
        read(deployment, async (unit) => ledgerOf(unit).append(erasure(20))),
      ).rejects.toThrow();
    });

    test('a rolled-back unit appends nothing', async () => {
      const before = await read(deployment, async (unit) => ledgerOf(unit).since(0n, 1000));
      await subject
        .run(deployment, async (unit) => {
          await ledgerOf(unit).append(erasure(30));
          throw new Error('boom');
        })
        .catch(() => undefined);
      const after = await read(deployment, async (unit) => ledgerOf(unit).since(0n, 1000));
      expect(after?.length).toBe(before?.length);
      expect(
        after?.some(
          (entry) =>
            entry.record.type === 'erasure' && entry.record.commandId === erasure(30).commandId,
        ),
      ).toBe(false);
    });
  });
}
