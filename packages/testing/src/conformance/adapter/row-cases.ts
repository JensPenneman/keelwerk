import { conformanceEntities, conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { rowAt } from './row-at.ts';
import { stamp } from './stamp.ts';

const { account, kitchen, owner, probe } = conformanceEntities;
const { tenantA, tenantB } = conformanceScopes;

const conflict = { kind: 'conflict', code: 'core.conflict' };
const mismatch = { kind: 'conflict', code: 'core.version_mismatch' };
const dangling = { kind: 'conflict', code: 'core.reference_missing' };

export function rowCases(subject: ConformanceSubject): void {
  describe('writes: ids, uniqueness and versions', () => {
    test('a duplicate id is core.conflict, also inside one call, and a failed insert leaves none of its rows', async () => {
      await subject.run(tenantA, (unit) => unit.rows.insert(owner, [rowAt(1, { name: 'a' })]));
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.rows.insert(owner, [rowAt(2, {}), rowAt(1, {})])),
        ),
      ).toEqual(conflict);
      expect(
        await failureOf(
          subject.run(tenantA, (unit) => unit.rows.insert(owner, [rowAt(3, {}), rowAt(3, {})])),
        ),
      ).toEqual(conflict);
      expect(await subject.read(tenantA, (unit) => unit.rows.count(owner))).toBe(1);
    });

    test('a unique field, a partial unique index and a unique pair each raise core.conflict', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(account, [
          rowAt(1, { handle: 'ann', slot: 1, kind: 'primary', region: 'eu', code: 'a' }),
        ]),
      );
      const insert = (n: number, values: Record<string, unknown>) =>
        failureOf(subject.run(tenantA, (unit) => unit.rows.insert(account, [rowAt(n, values)])));
      expect(await insert(2, { handle: 'ann' })).toEqual(conflict);
      expect(await insert(3, { handle: 'bob', slot: 1, kind: 'primary' })).toEqual(conflict);
      expect(await insert(4, { handle: 'cy', region: 'eu', code: 'a' })).toEqual(conflict);
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(account, [
          rowAt(5, { handle: 'dee', slot: 1, kind: 'other' }),
          rowAt(6, { handle: 'eve', region: 'eu', code: 'b' }),
          rowAt(7, { region: 'eu' }),
          rowAt(8, { region: 'eu' }),
        ]),
      );
      expect(await subject.read(tenantA, (unit) => unit.rows.count(account))).toBe(5);
    });

    test('archiving releases a unique value and restoring a taken one conflicts', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(account, [rowAt(1, { handle: 'ann' })]),
      );
      await subject.run(tenantA, (unit) =>
        unit.rows.update(account, [
          {
            id: conformanceId(1),
            expectedVersion: 1,
            values: rowAt(1, { version: 2, handle: 'ann', archivedAt: stamp }),
          },
        ]),
      );
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(account, [rowAt(2, { handle: 'ann' })]),
      );
      expect(
        await failureOf(
          subject.run(tenantA, (unit) =>
            unit.rows.update(account, [
              {
                id: conformanceId(1),
                expectedVersion: 2,
                values: rowAt(1, { version: 3, handle: 'ann' }),
              },
            ]),
          ),
        ),
      ).toEqual(conflict);
    });

    test('an update needs the expected version and replaces the whole row', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [rowAt(1, { name: 'a', rank: 3 })]),
      );
      await subject.run(tenantA, (unit) =>
        unit.rows.update(owner, [
          { id: conformanceId(1), expectedVersion: 1, values: rowAt(1, { version: 2, name: 'b' }) },
        ]),
      );
      const row = await subject.read(tenantA, (unit) => unit.rows.findOne(owner, {}));
      expect(row).toMatchObject({ name: 'b', version: 2 });
      expect(row?.rank).toBeUndefined();
      const stale = subject.run(tenantA, (unit) =>
        unit.rows.update(owner, [
          { id: conformanceId(1), expectedVersion: 1, values: rowAt(1, { version: 2 }) },
        ]),
      );
      expect(await failureOf(stale)).toEqual(mismatch);
      const missing = subject.run(tenantA, (unit) =>
        unit.rows.update(owner, [
          { id: conformanceId(9), expectedVersion: 1, values: rowAt(9, {}) },
        ]),
      );
      expect(await failureOf(missing)).toEqual(mismatch);
    });

    test('an update of several rows is all or nothing', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [rowAt(1, { name: 'a' }), rowAt(2, { name: 'b' })]),
      );
      const partly = subject.run(tenantA, (unit) =>
        unit.rows.update(owner, [
          {
            id: conformanceId(1),
            expectedVersion: 1,
            values: rowAt(1, { version: 2, name: 'changed' }),
          },
          { id: conformanceId(2), expectedVersion: 7, values: rowAt(2, { version: 8 }) },
        ]),
      );
      expect(await failureOf(partly)).toEqual(mismatch);
      const names = await subject.read(tenantA, async (unit) =>
        (await unit.rows.find(owner, { sort: [{ field: 'id', direction: 'asc' }] })).rows.map(
          (row) => row.name,
        ),
      );
      expect(names).toEqual(['a', 'b']);
    });

    test('a column the entity lacks, a missing required field and a non-UUID id are validation errors', async () => {
      const refused = (rows: readonly ReturnType<typeof rowAt>[]) =>
        failureOf(
          subject.run(tenantA, (unit) => unit.rows.insert(conformanceEntities.ticket, rows)),
        );
      expect((await refused([rowAt(1, { boxId: 'a', nope: 1 })])).kind).toBe('validation');
      expect((await refused([rowAt(1, {})])).kind).toBe('validation');
      expect((await refused([{ ...rowAt(1, { boxId: 'a' }), id: 'not-a-uuid' }])).kind).toBe(
        'validation',
      );
    });

    test('purge deletes the rows it finds and counts them', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [rowAt(1, {}), rowAt(2, {}), rowAt(3, { archivedAt: stamp })]),
      );
      const purged = await subject.run(tenantA, (unit) =>
        unit.rows.purge(owner, [conformanceId(1), conformanceId(3), conformanceId(99)]),
      );
      expect(purged).toBe(2);
      const left = await subject.read(tenantA, async (unit) =>
        (await unit.rows.find(owner, { includeArchived: true })).rows.map((row) => row.id),
      );
      expect(left).toEqual([conformanceId(2)]);
    });

    test('count and exists agree: archived rows are left out unless the query includes them', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [
          rowAt(1, { name: 'live' }),
          rowAt(2, { name: 'gone', archivedAt: stamp }),
        ]),
      );
      const [count, exists, all] = await subject.read(tenantA, async (unit) => [
        await unit.rows.count(owner),
        await unit.rows.exists(owner, [conformanceId(1), conformanceId(2), conformanceId(3)]),
        (await unit.rows.find(owner, { includeArchived: true })).rows.length,
      ]);
      expect(count).toBe(1);
      expect([...(exists as ReadonlySet<string>)]).toEqual([conformanceId(1)]);
      expect(all).toBe(2);
    });
  });

  describe('references: a missing target is core.reference_missing on every adapter', () => {
    test('a hard reference to a row that does not exist is refused, on insert and on update', async () => {
      const insert = subject.run(tenantA, (unit) =>
        unit.rows.insert(kitchen, [rowAt(1, { name: 'k', ownerId: conformanceId(50) })]),
      );
      expect(await failureOf(insert)).toEqual(dangling);
      expect(await subject.read(tenantA, (unit) => unit.rows.count(kitchen))).toBe(0);
      await subject.run(tenantA, async (unit) => {
        await unit.rows.insert(owner, [rowAt(50, { name: 'o' })]);
        await unit.rows.insert(kitchen, [rowAt(1, { name: 'k', ownerId: conformanceId(50) })]);
      });
      const update = subject.run(tenantA, (unit) =>
        unit.rows.update(kitchen, [
          {
            id: conformanceId(1),
            expectedVersion: 1,
            values: rowAt(1, { version: 2, ownerId: conformanceId(51) }),
          },
        ]),
      );
      expect(await failureOf(update)).toEqual(dangling);
    });

    test('the target may be written earlier in the same unit, or be absent from an optional reference', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.rows.insert(owner, [rowAt(60, { name: 'same unit' })]);
        await unit.rows.insert(kitchen, [
          rowAt(1, { ownerId: conformanceId(60) }),
          rowAt(2, { name: 'no reference' }),
        ]);
      });
      expect(await subject.read(tenantA, (unit) => unit.rows.count(kitchen))).toBe(2);
    });

    test('a row may refer to a later row of the same insert: keys are checked at the end of the statement', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [
          rowAt(2, { name: 'child', parentId: conformanceId(1) }),
          rowAt(1, { name: 'parent' }),
        ]),
      );
      expect(await subject.read(tenantA, (unit) => unit.rows.count(owner))).toBe(2);
      const dangling2 = subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [rowAt(3, { name: 'orphan', parentId: conformanceId(9) })]),
      );
      expect(await failureOf(dangling2)).toEqual(dangling);
    });

    test('a row that a hard reference points at cannot be purged, unless the referrer is purged with it', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.rows.insert(owner, [rowAt(1, { name: 'parent' })]);
        await unit.rows.insert(kitchen, [rowAt(5, { ownerId: conformanceId(1) })]);
        await unit.rows.insert(owner, [rowAt(2, { name: 'child', parentId: conformanceId(1) })]);
      });
      const refused = subject.run(tenantA, (unit) => unit.rows.purge(owner, [conformanceId(1)]));
      expect(await failureOf(refused)).toEqual(dangling);
      expect(await subject.read(tenantA, (unit) => unit.rows.count(owner))).toBe(2);
      await subject.run(tenantA, async (unit) => {
        expect(await unit.rows.purge(kitchen, [conformanceId(5)])).toBe(1);
        expect(await unit.rows.purge(owner, [conformanceId(1), conformanceId(2)])).toBe(2);
      });
      expect(await subject.read(tenantA, (unit) => unit.rows.count(owner))).toBe(0);
    });

    test('a target that a failed savepoint took back is missing', async () => {
      const refused = subject.run(tenantA, async (unit) => {
        await unit
          .nested(async (inner) => {
            await inner.rows.insert(owner, [rowAt(70, { name: 'undone' })]);
            throw new Error('undo');
          })
          .catch(() => undefined);
        await unit.rows.insert(kitchen, [rowAt(1, { ownerId: conformanceId(70) })]);
      });
      expect(await failureOf(refused)).toEqual(dangling);
    });

    test("another tenant's row is not a target", async () => {
      await subject.run(tenantB, (unit) =>
        unit.rows.insert(owner, [rowAt(80, { name: 'theirs' })]),
      );
      const refused = subject.run(tenantA, (unit) =>
        unit.rows.insert(kitchen, [rowAt(1, { ownerId: conformanceId(80) })]),
      );
      expect(await failureOf(refused)).toEqual(dangling);
    });

    test('a reference declared without a foreign key is not checked', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(probe, [rowAt(1, { label: 'soft', ownerId: conformanceId(90) })]),
      );
      expect(await subject.read(tenantA, (unit) => unit.rows.count(probe))).toBe(1);
    });
  });
}
