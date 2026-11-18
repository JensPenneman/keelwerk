import type {
  ControlLedger,
  ErasureCompletedRecord,
  ErasureRecord,
  KeyTombstoneRecord,
  Unit,
} from '@keelwerk/core';
import { beforeEach, describe, expect, test } from 'vitest';

const uuid = (): string => crypto.randomUUID();

function ledgerOf(unit: Unit): ControlLedger {
  if (unit.ledger === undefined) throw new Error('the deployment unit has no ledger');
  return unit.ledger;
}

/**
 * The indexed lookups of the control ledger (14.7.5, 14.7.6): `find` by erasure identity, tombstone
 * key and tombstone scope, and `unfinished` with its epochs, reruns and head. `inControl` runs a
 * unit in a deployment scope of the control root, which `restoreDetectionCases` provisioned.
 */
export function restoreDetectionLedgerCases(
  inControl: <T>(fn: (unit: Unit) => Promise<T>, readOnly?: boolean) => Promise<T>,
): void {
  describe('the ledger lookups', () => {
    let tenantId = uuid();
    beforeEach(() => {
      tenantId = uuid();
    });
    const erasure = (commandId: string, subjectId: string): ErasureRecord => ({
      type: 'erasure',
      tenantId,
      subjectId,
      recordedAt: '2026-11-17T10:00:00.000Z',
      requester: { kind: 'operator', id: null, via: 'core.operator' },
      reason: 'subjectRequest',
      commandId,
    });
    const completed = (
      commandId: string,
      subjectId: string,
      epoch: number,
    ): ErasureCompletedRecord => ({
      type: 'erasureCompleted',
      tenantId,
      commandId,
      subjectId,
      epoch,
      recordedAt: '2026-11-17T10:00:05.000Z',
    });
    const tombstone = (keyId: string, scopeId: string): KeyTombstoneRecord => ({
      type: 'keyTombstone',
      scopeId,
      keyId,
      recordedAt: '2026-11-17T10:00:01.000Z',
      reason: 'rotation',
    });
    const append = (record: ErasureRecord | ErasureCompletedRecord | KeyTombstoneRecord) =>
      inControl((unit) => ledgerOf(unit).append(record));

    test('find answers an erasure identity, a tombstone key and the tombstones of a scope, in seq order', async () => {
      const [commandId, subjectId, otherSubject] = [uuid(), uuid(), uuid()];
      const scopeId = uuid();
      const keyId = `key-${uuid()}`;
      const first = await append(erasure(commandId, subjectId));
      await append(erasure(commandId, otherSubject));
      const second = await append(tombstone(keyId, scopeId));
      const third = await append(tombstone(`key-${uuid()}`, scopeId));
      const find = (
        lookups: Parameters<ControlLedger['find']>[0],
        page?: Parameters<ControlLedger['find']>[1],
      ) => inControl((unit) => ledgerOf(unit).find(lookups, page), true);
      expect(
        (await find([{ type: 'erasure', tenantId, commandId, subjectId }])).map((e) => e.seq),
      ).toEqual([first]);
      expect(await find([{ type: 'erasureCompleted', tenantId, commandId, subjectId }])).toEqual(
        [],
      );
      expect((await find([{ type: 'keyTombstone', keyId }])).map((e) => e.seq)).toEqual([second]);
      const byScope = await find([{ type: 'keyTombstone', scopeId }]);
      expect(byScope.map((e) => e.seq)).toEqual([second, third]);
      const mixed = await find([
        { type: 'keyTombstone', scopeId },
        { type: 'erasure', tenantId, commandId, subjectId },
      ]);
      expect(mixed.map((e) => e.seq)).toEqual([first, second, third]);
      expect(
        (await find([{ type: 'keyTombstone', scopeId }], { limit: 1 })).map((e) => e.seq),
      ).toEqual([second]);
      expect(
        (await find([{ type: 'keyTombstone', scopeId }], { after: second })).map((e) => e.seq),
      ).toEqual([third]);
      expect(await find([])).toEqual([]);
    });

    test('unfinished leaves out an erasure completed at the tenant epoch, answers it with rerun after the epoch moves, and answers the head', async () => {
      const [commandId, subjectId, openSubject] = [uuid(), uuid(), uuid()];
      const done = await append(erasure(commandId, subjectId));
      await append(completed(commandId, subjectId, 0));
      const open = await append(erasure(uuid(), openSubject));
      const unfinished = (epoch: number) =>
        inControl(
          (unit) =>
            ledgerOf(unit).unfinished({
              epochs: new Map([[tenantId, epoch]]),
              after: 0n,
              limit: 100,
              tenantIds: [tenantId],
            }),
          true,
        );
      const now = await unfinished(0);
      expect(now.erasures.map((e) => e.seq)).toEqual([open]);
      expect(now.erasures[0]?.rerun).toBe(false);
      expect(now.head).toBeGreaterThanOrEqual(open);
      const moved = await unfinished(1);
      expect(moved.erasures.map((e) => [e.seq, e.rerun])).toEqual([
        [done, true],
        [open, false],
      ]);
      const paged = await inControl(
        (unit) =>
          ledgerOf(unit).unfinished({
            epochs: new Map(),
            after: done,
            limit: 1,
            tenantIds: [tenantId],
          }),
        true,
      );
      expect(paged.erasures.map((e) => e.seq)).toEqual([open]);
      // A completion of another epoch, or one that stands before the record, does not finish it.
      await append(completed(commandId, subjectId, 1));
      expect((await unfinished(1)).erasures.map((e) => e.seq)).toEqual([open]);
    });
  });
}
