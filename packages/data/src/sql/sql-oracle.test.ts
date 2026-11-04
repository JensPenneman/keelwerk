import type { PGlite } from '@electric-sql/pglite';
import type { Condition } from '@keelwerk/core';
import { evaluateCondition } from '@keelwerk/core';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { contextFor } from '../../test/support/context-for.ts';
import { dummyDb } from '../../test/support/dummy-db.ts';
import { id } from '../../test/support/id.ts';
import { kindOf } from '../../test/support/kind-of.ts';
import { live } from '../../test/support/live.ts';
import { note } from '../../test/support/note.ts';
import { openFixture } from '../../test/support/open-fixture.ts';
import { teamRed } from '../../test/support/team-red.ts';
import { tenantScope } from '../../test/support/tenant-scope.ts';
import { compileCondition } from './compile-condition.ts';

let pg: PGlite;

beforeAll(async () => {
  pg = await openFixture();
}, 60_000);

afterAll(async () => {
  await pg.close();
});

async function selectIds(condition: Condition | undefined): Promise<string[]> {
  const ctx = contextFor(note);
  const compiled = dummyDb(tenantScope)
    .selectFrom(ctx.table.from)
    .select(sql<string>`${sql.ref('t.id')}::text`.as('id'))
    .where(sql<boolean>`${sql.ref('t.archived_at')} is null`)
    .$if(condition !== undefined, (q) => q.where(compileCondition(ctx, condition as Condition)))
    .orderBy(sql.ref('t.id'))
    .compile();
  const result = await pg.query<{ id: string }>(compiled.sql, [...compiled.parameters]);
  return result.rows.map((row) => row.id);
}

const e = (field: string, op: string, value: unknown): Condition =>
  ({ op, field, value }) as Condition;
const date = (text: string): Temporal.PlainDate => Temporal.PlainDate.from(text);
const at = (text: string): Temporal.Instant => Temporal.Instant.from(text);

const comparisons: readonly (readonly [string, Condition])[] = [
  ['eq string', e('title', 'eq', 'alpha')],
  ['eq case', e('title', 'eq', 'Alpha')],
  ['eq null operand', e('title', 'eq', null)],
  ['eq integer', e('count', 'eq', 2)],
  ['eq wide', e('big', 'eq', 9007199254740993n)],
  ['eq decimal numeric', e('price', 'eq', '1.5')],
  ['eq float', e('ratio', 'eq', 0.5)],
  ['eq boolean', e('done', 'eq', false)],
  ['eq date', e('due', 'eq', date('2026-01-01'))],
  ['eq instant', e('at', 'eq', at('2026-01-01T00:00:00.123Z'))],
  ['eq bytes', e('blob', 'eq', new Uint8Array([1, 2]))],
  ['eq ref', e('teamId', 'eq', teamRed)],
  ['ne string', e('title', 'ne', 'alpha')],
  ['ne absent is not equal', e('count', 'ne', 2)],
  ['ne null operand', e('title', 'ne', null)],
  ['ne bytes', e('blob', 'ne', new Uint8Array([1, 2]))],
  ['lt integer', e('count', 'lt', 3)],
  ['lte integer', e('count', 'lte', 2)],
  ['gt decimal', e('price', 'gt', '2')],
  ['gte decimal', e('price', 'gte', '2.50')],
  ['lt string by code point', e('title', 'lt', 'b')],
  ['gt date', e('due', 'gt', date('2026-01-01'))],
  ['gte instant', e('at', 'gte', at('2026-01-15T00:00:00Z'))],
  ['in strings', e('title', 'in', ['alpha', 'beta', 'zzz'])],
  ['in empty', e('title', 'in', [])],
  ['in with null', e('title', 'in', ['alpha', null])],
  ['in integers', e('count', 'in', [1, 3, 5])],
  ['nin strings', e('title', 'nin', ['alpha', 'beta'])],
  ['nin empty', e('title', 'nin', [])],
  ['nin integers', e('count', 'nin', [1, 2])],
  ['contains plain', e('body', 'contains', 'World')],
  ['contains percent', e('title', 'contains', '%')],
  ['contains underscore', e('title', 'contains', '_')],
  ['contains backslash', e('body', 'contains', '\\')],
  ['contains empty', e('title', 'contains', '')],
  ['contains case', e('title', 'contains', 'alpha')],
  ['contains set element', e('tags', 'contains', 'y')],
  ['contains list element', e('labels', 'contains', 'b')],
  ['startsWith', e('title', 'startsWith', 'alpha')],
  ['startsWith wildcard', e('title', 'startsWith', 'al_')],
  ['startsWith backslash', e('title', 'startsWith', 'ab\\')],
  ['isNull true', e('title', 'isNull', true)],
  ['isNull false', e('count', 'isNull', false)],
  ['isNull json', e('data', 'isNull', true)],
  ['never', { op: 'never' }],
  ['and', { op: 'and', conditions: [e('title', 'eq', 'alpha'), e('count', 'eq', 1)] }],
  ['and empty', { op: 'and', conditions: [] }],
  ['or', { op: 'or', conditions: [e('title', 'eq', 'alpha'), e('count', 'gt', 2)] }],
  ['or empty', { op: 'or', conditions: [] }],
  ['not eq keeps absent', { op: 'not', condition: e('title', 'eq', 'alpha') }],
  ['not lt keeps absent', { op: 'not', condition: e('count', 'lt', 3) }],
  ['not ne', { op: 'not', condition: e('title', 'ne', 'alpha') }],
  [
    'not or',
    {
      op: 'not',
      condition: { op: 'or', conditions: [e('title', 'eq', 'alpha'), e('count', 'eq', 2)] },
    },
  ],
  ['not not', { op: 'not', condition: { op: 'not', condition: e('count', 'eq', 2) } }],
  ['not contains', { op: 'not', condition: e('body', 'contains', 'o') }],
  ['not in', { op: 'not', condition: e('title', 'in', ['alpha']) }],
  ['not never', { op: 'not', condition: { op: 'never' } }],
];

describe('compiled filters against PostgreSQL equal the in-memory interpreter', () => {
  test.each(comparisons)('%s', async (_name, condition) => {
    const expected = live
      .filter((row) => evaluateCondition(condition, row, { kindOf }))
      .map((row) => String(row.id))
      .sort();
    expect(await selectIds(condition)).toEqual(expected);
  });
});

describe('relation quantifiers', () => {
  const red = e('name', 'eq', 'red');
  const idsOf = (...numbers: number[]): string[] => numbers.map(id);

  test('some', async () => {
    expect(await selectIds({ op: 'some', relation: 'team', where: red })).toEqual(idsOf(1, 2));
  });

  test('is on an absent reference is false', async () => {
    expect(await selectIds({ op: 'is', relation: 'team', where: e('name', 'eq', 'blue') })).toEqual(
      idsOf(3),
    );
  });

  test('none', async () => {
    expect(await selectIds({ op: 'none', relation: 'team', where: red })).toEqual(
      idsOf(3, 4, 5, 6, 8, 9),
    );
  });

  test('every holds for an empty relation', async () => {
    expect(await selectIds({ op: 'every', relation: 'team', where: red })).toEqual(
      idsOf(1, 2, 4, 5, 6, 8, 9),
    );
  });

  test('a dotted path walks two relations and ignores archived rows', async () => {
    const users = e('role', 'eq', 'user');
    expect(await selectIds({ op: 'every', relation: 'team.members', where: users })).toEqual(
      idsOf(3, 4, 5, 6, 8, 9),
    );
    expect(
      await selectIds({ op: 'some', relation: 'team.members', where: e('role', 'eq', 'admin') }),
    ).toEqual(idsOf(1, 2));
  });

  test('a to-many relation matches on the key of the related rows', async () => {
    expect(
      await selectIds({ op: 'some', relation: 'watchers', where: e('role', 'eq', 'admin') }),
    ).toEqual(idsOf(1, 2));
  });

  test('a quantifier nests and combines with other conditions under not', async () => {
    const nested: Condition = {
      op: 'not',
      condition: {
        op: 'some',
        relation: 'team',
        where: { op: 'some', relation: 'members', where: e('role', 'eq', 'admin') },
      },
    };
    expect(await selectIds(nested)).toEqual(idsOf(3, 4, 5, 6, 8, 9));
  });

  test('the subqueries are scoped to the tenant', async () => {
    // Tenant 2 owns a team named red; note 9 of tenant 1 points at it and must not match.
    const found = await selectIds({ op: 'some', relation: 'team', where: e('name', 'eq', 'red') });
    expect(found).not.toContain(id(50));
    expect(found).not.toContain(id(9));
    expect(found).toEqual(idsOf(1, 2));
  });
});
