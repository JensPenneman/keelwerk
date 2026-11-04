import type { Condition, StorageScope } from '@keelwerk/core';
import { conformanceEntities, conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { rowAt } from './row-at.ts';

const { kitchen, owner, probe } = conformanceEntities;
const { tenantA, tenantB } = conformanceScopes;
const forbidden = { kind: 'forbidden', code: 'core.forbidden' };

export function rowIsolationCases(subject: ConformanceSubject): void {
  describe('two tenants over rows (14.4.3, 14.10 case 5)', () => {
    test('a tenant sees none of the rows of another, by any read', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [rowAt(1, { name: 'a', rank: 1 })]),
      );
      await subject.run(tenantB, (unit) =>
        unit.rows.insert(owner, [rowAt(2, { name: 'b', rank: 2 })]),
      );
      const seen = async (scope: StorageScope): Promise<unknown[]> =>
        subject.read(scope, async (unit) => {
          const page = await unit.rows.find(owner, { includeArchived: true });
          return [
            page.rows.map((row) => row.name),
            await unit.rows.count(owner),
            [...(await unit.rows.exists(owner, [conformanceId(1), conformanceId(2)]))],
            [
              ...(await unit.rows.matching(owner, [conformanceId(1), conformanceId(2)], {
                op: 'gte',
                field: 'rank',
                value: 0,
              })),
            ],
            (
              await unit.rows.findOne(owner, {
                where: { op: 'eq', field: 'id', value: conformanceId(1) },
              })
            )?.name,
            (await unit.rows.find(owner, { page: { first: 5 }, total: true })).total,
          ];
        });
      expect(await seen(tenantA)).toEqual([
        ['a'],
        1,
        [conformanceId(1)],
        [conformanceId(1)],
        'a',
        1,
      ]);
      expect(await seen(tenantB)).toEqual([
        ['b'],
        1,
        [conformanceId(2)],
        [conformanceId(2)],
        undefined,
        1,
      ]);
    });

    test('a tenant cannot update or purge the rows of another', async () => {
      await subject.run(tenantA, (unit) => unit.rows.insert(owner, [rowAt(1, { name: 'a' })]));
      const update = subject.run(tenantB, (unit) =>
        unit.rows.update(owner, [
          {
            id: conformanceId(1),
            expectedVersion: 1,
            values: rowAt(1, { version: 2, name: 'hijacked' }),
          },
        ]),
      );
      expect((await failureOf(update)).kind).toBe('conflict');
      expect(await subject.run(tenantB, (unit) => unit.rows.purge(owner, [conformanceId(1)]))).toBe(
        0,
      );
      expect((await subject.read(tenantA, (unit) => unit.rows.findOne(owner, {})))?.name).toBe('a');
    });

    test('a row that carries the scope column of another tenant is refused', async () => {
      const refused = subject.run(tenantA, (unit) =>
        unit.rows.insert(owner, [
          rowAt(1, { name: 'x', tenantId: conformanceScopes.tenantB.tenantId }),
        ]),
      );
      expect(await failureOf(refused)).toEqual(forbidden);
      expect(await subject.read(tenantB, (unit) => unit.rows.count(owner))).toBe(0);
    });

    test('relation quantifiers see the rows of their own tenant only', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.rows.insert(owner, [rowAt(1, { name: 'a', rank: 1 })]);
        await unit.rows.insert(probe, [rowAt(11, { label: 'in a', ownerId: conformanceId(1) })]);
      });
      await subject.run(tenantB, async (unit) => {
        await unit.rows.insert(owner, [rowAt(2, { name: 'b', rank: 9 })]);
        await unit.rows.insert(probe, [
          rowAt(12, { label: 'dangling in b', ownerId: conformanceId(1) }),
          rowAt(13, { label: 'in b', ownerId: conformanceId(2) }),
        ]);
      });
      const ids = (scope: StorageScope, where: Condition) =>
        subject.read(scope, async (unit) =>
          (
            await unit.rows.find(probe, {
              where,
              sort: [{ field: 'id', direction: 'asc' }],
            })
          ).rows.map((row) => row.id),
        );
      const ownerHasRank: Condition = {
        op: 'is',
        relation: 'owner',
        where: { op: 'gte', field: 'rank', value: 0 },
      };
      expect(await ids(tenantA, ownerHasRank)).toEqual([conformanceId(11)]);
      expect(await ids(tenantB, ownerHasRank)).toEqual([conformanceId(13)]);
      const owners = (scope: StorageScope) =>
        subject.read(scope, async (unit) =>
          (
            await unit.rows.find(owner, {
              where: {
                op: 'every',
                relation: 'probes',
                where: { op: 'eq', field: 'label', value: 'in a' },
              },
            })
          ).rows.map((row) => row.id),
        );
      expect(await owners(tenantA)).toEqual([conformanceId(1)]);
      expect(await owners(tenantB)).toEqual([]);
    });

    test("a hard reference cannot reach another tenant's row", async () => {
      await subject.run(tenantA, (unit) => unit.rows.insert(owner, [rowAt(1, { name: 'a' })]));
      const refused = subject.run(tenantB, (unit) =>
        unit.rows.insert(kitchen, [rowAt(5, { ownerId: conformanceId(1) })]),
      );
      expect(await failureOf(refused)).toEqual({
        kind: 'conflict',
        code: 'core.reference_missing',
      });
    });
  });
}
