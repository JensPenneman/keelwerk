import type { Condition, StorageRow, Unit } from '@keelwerk/core';
import { createSealingContext, planEncryption, sealingUnit } from '@keelwerk/core';
import {
  conformanceEntities,
  conformanceId,
  conformanceScopes,
  unsealingOracle,
} from '@keelwerk/data/conformance';
import { assert, asyncProperty, oneof, sample } from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { encryptedQueryPools } from './encrypted-query-pools.ts';
import { failureOf } from './failure-of.ts';
import { personRow } from './person-row.ts';
import { randomPeople } from './random-people.ts';
import { randomPersonConditions } from './random-person-conditions.ts';
import { sealingOptionsOf } from './sealing-options-of.ts';

const { person } = conformanceEntities;
const scope = conformanceScopes.tenantA;
const stamp = Temporal.Instant.from('2026-01-01T00:00:00Z');
const { exact: exactConditions, prefixed: prefixConditions } = randomPersonConditions;

const idsOf = (rows: readonly StorageRow[]): string[] => rows.map((row) => String(row.id)).sort();

export function encryptedQueryCases(subject: ConformanceSubject): void {
  const insert = (rows: readonly StorageRow[], maxScan?: number) =>
    subject.run(scope, async (raw) => {
      await sealingUnit(raw, sealingOptionsOf(subject, maxScan)).rows.insert(person, rows);
    });

  const sealed = <T>(fn: (unit: Unit) => Promise<T>, maxScan?: number): Promise<T> =>
    subject.read(scope, (raw) => fn(sealingUnit(raw, sealingOptionsOf(subject, maxScan))));

  const found = async (condition: Condition): Promise<string[]> =>
    idsOf(
      (
        await sealed((unit) =>
          unit.rows.find(person, { where: condition, sort: [{ field: 'id', direction: 'asc' }] }),
        )
      ).rows,
    );

  describe('encrypted queries against the unsealing oracle (14.10 case 13)', () => {
    const runs = subject.networked ? 25 : 60;

    test.each([1, 2, 3])(
      'rewritten and verified conditions select the rows the oracle selects (dataset seed %i)',
      async (seed) => {
        const [rows] = sample(randomPeople(), { seed, numRuns: 1 });
        if (rows === undefined) throw new Error('no dataset');
        await insert(rows);
        await assert(
          asyncProperty(oneof(exactConditions, prefixConditions), async (condition) => {
            const wanted = unsealingOracle(person, condition, rows);
            expect(await found(condition)).toEqual(wanted);
            expect(await sealed((unit) => unit.rows.count(person, condition))).toBe(wanted.length);
            const ids = rows.map((row) => String(row.id));
            const matched = await sealed((unit) => unit.rows.matching(person, ids, condition));
            expect([...matched].sort()).toEqual(wanted);
          }),
          { numRuns: runs, seed },
        );
      },
      240_000,
    );

    test.each([1, 2])(
      'the adapter answers the rewritten exact conditions on its own, before any verification (seed %i)',
      async (seed) => {
        const [rows] = sample(randomPeople(), { seed: seed + 10, numRuns: 1 });
        if (rows === undefined) throw new Error('no dataset');
        await insert(rows);
        await assert(
          asyncProperty(exactConditions, async (condition) => {
            const raw = await subject.read(scope, async (unit) => {
              const plan = await planEncryption(
                createSealingContext(unit, sealingOptionsOf(subject)),
                person,
                condition,
              );
              expect(plan.scan).toBe(false);
              return unit.rows.find(person, {
                where: plan.condition,
                sort: [{ field: 'id', direction: 'asc' }],
              });
            });
            expect(idsOf(raw.rows)).toEqual(unsealingOracle(person, condition, rows));
          }),
          { numRuns: runs, seed: seed + 10 },
        );
      },
      240_000,
    );
  });

  describe('sealed storage and normalised equality (14.7.9)', () => {
    const row = (n: number, values: Record<string, unknown>) =>
      personRow(n, { subject: encryptedQueryPools.subjects[0], ...values });

    test('the table holds sealed bytes and 16-byte tags, and reads return plain values without tags', async () => {
      await insert([row(1, { mail: 'Jens@JensPenneman.com', age: 41, note: 'secret' })]);
      const stored = await subject.read(scope, (unit) =>
        unit.rows.find(person, {
          select: ['mail', 'age', 'note', 'mail__eq', 'age__eq'],
        }),
      );
      const [raw] = stored.rows;
      for (const column of ['mail', 'age', 'note']) {
        expect(raw?.[column]).toBeInstanceOf(Uint8Array);
      }
      const tag = raw?.mail__eq;
      expect(tag instanceof Uint8Array ? tag.length : -1).toBe(16);
      expect(raw).not.toHaveProperty('note__eq');
      const text = Buffer.from(
        JSON.stringify(stored.rows, (_k, v: unknown) =>
          v instanceof Uint8Array ? Buffer.from(v).toString('latin1') : v,
        ),
      );
      for (const marker of ['jens', 'JensPenneman', 'secret']) {
        expect(text.toString().toLowerCase()).not.toContain(marker.toLowerCase());
      }
      const [plain] = (await sealed((unit) => unit.rows.find(person, {}))).rows;
      expect(plain).toMatchObject({ mail: 'Jens@JensPenneman.com', age: 41, note: 'secret' });
      expect(plain).not.toHaveProperty('mail__eq');
    });

    test('another tenant stores the same value under a different tag and its query sees none of the first tenant rows', async () => {
      const other = conformanceScopes.tenantB;
      const options = sealingOptionsOf(subject);
      await insert([
        row(1, { mail: 'shared@example.org' }),
        row(2, { mail: 'only-first@example.org' }),
      ]);
      await subject.run(other, async (raw) => {
        await sealingUnit(raw, options).rows.insert(person, [
          row(3, { mail: 'Shared@Example.org' }),
        ]);
      });
      const tagIn = async (where: typeof scope, id: number): Promise<string> => {
        const stored = await subject.read(where, (unit) =>
          unit.rows.find(person, {
            select: ['mail__eq'],
            where: { op: 'eq', field: 'id', value: conformanceId(id) },
          }),
        );
        const tag = stored.rows[0]?.mail__eq;
        if (!(tag instanceof Uint8Array)) throw new Error('the row holds no tag');
        return Buffer.from(tag).toString('hex');
      };
      expect(await tagIn(scope, 1001)).not.toBe(await tagIn(other, 1003));
      const idsIn = async (where: typeof scope, value: string): Promise<string[]> =>
        idsOf(
          (
            await subject.read(where, (raw) =>
              sealingUnit(raw, options).rows.find(person, {
                where: { op: 'eq', field: 'mail', value },
              }),
            )
          ).rows,
        );
      expect(await idsIn(scope, 'shared@example.org')).toEqual([conformanceId(1001)]);
      expect(await idsIn(other, 'shared@example.org')).toEqual([conformanceId(1003)]);
      expect(await idsIn(other, 'only-first@example.org')).toEqual([]);
    });

    test('Jens@JensPenneman.com equals jens@jenspenneman.com under email, also for the unique index', async () => {
      await insert([row(1, { address: 'Jens@JensPenneman.com' })]);
      expect(await found({ op: 'eq', field: 'address', value: 'jens@jenspenneman.com' })).toEqual([
        conformanceId(1001),
      ]);
      const twice = insert([row(2, { address: ' jens@JENSPENNEMAN.com' })]);
      expect((await failureOf(twice)).kind).toBe('conflict');
      await insert([row(3, { address: 'other@example.org' })]);
    });

    test('a unique caseless handle conflicts across cases, and archiving releases it', async () => {
      await insert([row(1, { handle: 'Ada' })]);
      expect((await failureOf(insert([row(2, { handle: 'ADA' })]))).kind).toBe('conflict');
      await subject.run(scope, async (raw) => {
        const unit = sealingUnit(raw, sealingOptionsOf(subject));
        const [current] = (await unit.rows.find(person, {})).rows;
        if (current === undefined) throw new Error('no row');
        await unit.rows.update(person, [
          {
            id: conformanceId(1001),
            expectedVersion: 1,
            values: { ...current, version: 2, archivedAt: stamp },
          },
        ]);
      });
      await insert([row(2, { handle: 'ADA' })]);
    });

    test('a sealed value moved to another row reads as absent', async () => {
      await insert([row(1, { mail: 'a@example.org' }), row(2, { mail: 'b@example.org' })]);
      await subject.run(scope, async (raw) => {
        const page = await raw.rows.find(person, {
          select: Object.keys(person.fields).concat(Object.keys(person.derivedIndexes)),
          sort: [{ field: 'id', direction: 'asc' }],
        });
        const tagColumn = 'mail__eq';
        const [first, second] = page.rows;
        if (first === undefined || second === undefined) throw new Error('two rows');
        await raw.rows.update(person, [
          {
            id: String(second.id),
            expectedVersion: 1,
            values: { ...second, mail: first.mail, [tagColumn]: first[tagColumn] },
          },
        ]);
      });
      const rows = (
        await sealed((unit) =>
          unit.rows.find(person, { sort: [{ field: 'id', direction: 'asc' }] }),
        )
      ).rows;
      expect(rows[0]).toMatchObject({ mail: 'a@example.org' });
      expect(rows[1]).not.toHaveProperty('mail');
      // The moved tag still selects row 2, but the unsealed value does not confirm it.
      expect(await found({ op: 'eq', field: 'mail', value: 'a@example.org' })).toEqual([
        conformanceId(1001),
      ]);
    });

    test('a prefix scan past the limit fails with core.scan_limit, and the rest of the condition narrows it', async () => {
      await insert(
        [1, 2, 3, 4, 5, 6].map((n) =>
          row(n, { label: n < 3 ? 'x' : 'y', mail: `person${n}@example.org` }),
        ),
      );
      const prefix: Condition = { op: 'startsWith', field: 'mail', value: 'per' };
      const refused = sealed((unit) => unit.rows.find(person, { where: prefix }), 5);
      expect(await failureOf(refused)).toMatchObject({
        kind: 'unsupported',
        code: 'core.scan_limit',
      });
      const narrowed = await sealed(
        (unit) =>
          unit.rows.find(person, {
            where: { op: 'and', conditions: [prefix, { op: 'eq', field: 'label', value: 'x' }] },
          }),
        5,
      );
      expect(idsOf(narrowed.rows)).toEqual([conformanceId(1001), conformanceId(1002)]);
    });

    test('what a field does not declare is core.personal_operator and a short needle core.personal_needle_short', async () => {
      await insert([row(1, { mail: 'a@example.org', note: 'n' })]);
      const refusals: readonly Condition[] = [
        { op: 'eq', field: 'note', value: 'n' },
        { op: 'contains', field: 'mail', value: 'exa' },
        { op: 'lt', field: 'mail', value: 'b' },
        { op: 'startsWith', field: 'exactName', value: 'abc' },
        { op: 'not', condition: { op: 'startsWith', field: 'mail', value: 'abc' } },
      ];
      for (const where of refusals) {
        const refused = sealed((unit) => unit.rows.find(person, { where }));
        expect(await failureOf(refused), JSON.stringify(where)).toMatchObject({
          kind: 'unsupported',
          code: 'core.personal_operator',
        });
      }
      const short = sealed((unit) =>
        unit.rows.find(person, { where: { op: 'startsWith', field: 'mail', value: 'a@' } }),
      );
      expect(await failureOf(short)).toMatchObject({ code: 'core.personal_needle_short' });
    });

    test('shredding a subject makes its values read as absent and no condition discloses its rows', async () => {
      await insert([row(1, { mail: 'a@example.org' })]);
      await subject.run(scope, (unit) => unit.keys.shred(encryptedQueryPools.subjects[0] ?? ''));
      const [after] = (await sealed((unit) => unit.rows.find(person, {}))).rows;
      expect(after).toBeDefined();
      expect(after).not.toHaveProperty('mail');
      expect(await found({ op: 'eq', field: 'mail', value: 'a@example.org' })).toEqual([]);
    });
  });
}
