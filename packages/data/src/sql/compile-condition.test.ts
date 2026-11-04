import type { Condition } from '@keelwerk/core';
import { sql } from 'kysely';
import { describe, expect, test } from 'vitest';
import { contextFor } from '../../test/support/context-for.ts';
import { dummyDb } from '../../test/support/dummy-db.ts';
import { note } from '../../test/support/note.ts';
import { compileCondition } from './compile-condition.ts';

const prefix = 'select 1 as "one" from "app"."app__note" as "t" where ';

function compile(condition: Condition): { sql: string; parameters: readonly unknown[] } {
  const context = contextFor(note);
  const compiled = dummyDb()
    .selectFrom(context.table.from)
    .select(sql.lit(1).as('one'))
    .where(compileCondition(context, condition))
    .compile();
  return { sql: compiled.sql.replace(prefix, ''), parameters: compiled.parameters };
}

const e = (field: string, op: string, value: unknown): Condition =>
  ({ op, field, value }) as Condition;

type Golden = readonly [name: string, condition: Condition, sql: string, parameters: unknown[]];

const goldens: readonly Golden[] = [
  ['eq', e('title', 'eq', 'a'), 'coalesce("t"."title" = $1, false)', ['a']],
  ['eq on a null operand matches nothing', e('title', 'eq', null), 'false', []],
  ['eq on an undefined operand matches nothing', e('title', 'eq', undefined), 'false', []],
  [
    'eq on a decimal binds the string',
    e('price', 'eq', '1.50'),
    'coalesce("t"."price" = $1, false)',
    ['1.50'],
  ],
  [
    'eq on an instant binds milliseconds',
    e('at', 'eq', Temporal.Instant.from('2026-01-01T00:00:00.1239Z')),
    'coalesce("t"."at" = $1, false)',
    ['2026-01-01T00:00:00.123Z'],
  ],
  [
    'eq on a wide integer binds text',
    e('big', 'eq', 9007199254740993n),
    'coalesce("t"."big" = $1, false)',
    ['9007199254740993'],
  ],
  ['ne is IS DISTINCT FROM', e('title', 'ne', 'a'), '"t"."title" is distinct from $1', ['a']],
  ['ne on a null operand matches nothing', e('title', 'ne', null), 'false', []],
  [
    'lt keeps absent values out',
    e('count', 'lt', 3),
    '("t"."count" is not null and "t"."count" < $1)',
    [3],
  ],
  ['lte', e('count', 'lte', 3), '("t"."count" is not null and "t"."count" <= $1)', [3]],
  ['gt', e('price', 'gt', '2'), '("t"."price" is not null and "t"."price" > $1)', ['2']],
  ['gte', e('count', 'gte', 3), '("t"."count" is not null and "t"."count" >= $1)', [3]],
  [
    'in is = ANY of a typed array',
    e('title', 'in', ['a', 'b']),
    'coalesce("t"."title" = any($1::text[]), false)',
    [['a', 'b']],
  ],
  [
    'in on integers casts to bigint[]',
    e('count', 'in', [1, 2]),
    'coalesce("t"."count" = any($1::bigint[]), false)',
    [[1, 2]],
  ],
  ['in with an empty list matches nothing', e('title', 'in', []), 'false', []],
  ['in with a null member matches nothing', e('title', 'in', ['a', null]), 'false', []],
  [
    'nin is the null-safe negation',
    e('title', 'nin', ['a', 'b']),
    '("t"."title" is null or not ("t"."title" = any($1::text[])))',
    [['a', 'b']],
  ],
  ['nin with an empty list matches everything', e('title', 'nin', []), 'true', []],
  [
    'contains on text is an escaped LIKE',
    e('body', 'contains', '50%_x\\'),
    'coalesce("t"."body" like $1 escape \'\\\', false)',
    ['%50\\%\\_x\\\\%'],
  ],
  ['contains with a non-string operand matches nothing', e('title', 'contains', 3), 'false', []],
  [
    'contains on a set is @>',
    e('tags', 'contains', 'x'),
    'coalesce("t"."tags" @> $1::jsonb, false)',
    ['["x"]'],
  ],
  [
    'contains on a list is @>',
    e('labels', 'contains', 'x'),
    'coalesce("t"."labels" @> $1::jsonb, false)',
    ['["x"]'],
  ],
  [
    'startsWith is an escaped prefix LIKE',
    e('title', 'startsWith', 'a_'),
    'coalesce("t"."title" like $1 escape \'\\\', false)',
    ['a\\_%'],
  ],
  ['isNull true', e('title', 'isNull', true), '"t"."title" is null', []],
  ['isNull false', e('count', 'isNull', false), '"t"."count" is not null', []],
  [
    'isNull on a personal field reads the sealed column',
    e('email', 'isNull', true),
    '"t"."email" is null',
    [],
  ],
  ['never', { op: 'never' }, 'false', []],
  [
    'and',
    { op: 'and', conditions: [e('title', 'eq', 'a'), e('count', 'lt', 3)] },
    'coalesce(("t"."title" = $1 and ("t"."count" is not null and "t"."count" < $2)), false)',
    ['a', 3],
  ],
  ['and of nothing is true', { op: 'and', conditions: [] }, 'true', []],
  ['or of nothing is false', { op: 'or', conditions: [] }, 'false', []],
  [
    'or',
    { op: 'or', conditions: [e('title', 'eq', 'a'), e('count', 'eq', 1)] },
    'coalesce(("t"."title" = $1 or "t"."count" = $2), false)',
    ['a', 1],
  ],
  [
    'not wraps a nullable predicate in COALESCE',
    { op: 'not', condition: e('title', 'eq', 'a') },
    'not coalesce("t"."title" = $1, false)',
    ['a'],
  ],
  [
    'not of a null-safe predicate needs none',
    { op: 'not', condition: e('title', 'ne', 'a') },
    'not ("t"."title" is distinct from $1)',
    ['a'],
  ],
  [
    'a rewritten equality tag compares bytea',
    e('emailEq', 'in', [new Uint8Array([1, 2]), new Uint8Array([3])]),
    'coalesce("t"."email__eq" = any($1::bytea[]), false)',
    [[new Uint8Array([1, 2]), new Uint8Array([3])]],
  ],
];

describe('compileCondition golden SQL', () => {
  test.each(goldens)('%s', (_name, condition, expectedSql, parameters) => {
    expect(compile(condition)).toEqual({ sql: expectedSql, parameters });
  });
});

describe('what the database cannot answer is unsupported or malformed, never approximated', () => {
  test('startsWith on a personal field with prefix tags is unsupported until M4 (S-37)', () => {
    expect(() => compile(e('email', 'startsWith', 'ab'))).toThrow(
      expect.objectContaining({
        kind: 'unsupported',
        code: 'core.personal_operator',
        details: expect.objectContaining({ op: 'startsWith', field: 'email' }),
      }),
    );
  });

  test.each([
    ['eq', 'a'],
    ['contains', 'a'],
    ['lt', 'a'],
  ])('%s on a personal field the planner did not rewrite', (op, value) => {
    expect(() => compile(e('email', op, value))).toThrow(
      expect.objectContaining({ kind: 'unsupported', code: 'core.personal_operator' }),
    );
  });

  test('a prefix tag column has no operator in M1', () => {
    expect(() => compile(e('emailEq', 'startsWith', 'a'))).toThrow(
      expect.objectContaining({ code: 'core.personal_operator' }),
    );
  });

  test.each([
    ['json supports only isNull', e('data', 'eq', 1)],
    ['a set supports contains and isNull', e('tags', 'eq', 'a')],
    ['bytes support eq, ne and isNull', e('blob', 'lt', new Uint8Array([1]))],
    ['a sealed credential supports nothing', e('secret', 'isNull', true)],
    ['contains needs a string kind or a collection', e('count', 'contains', '1')],
    ['startsWith needs a string kind', e('due', 'startsWith', '2')],
    ['an unknown field', e('nope', 'eq', 1)],
    ['a malformed isNull', e('title', 'isNull', 'yes')],
    ['an operand that does not fit the field', e('count', 'eq', 'x')],
    ['an in operand that is not a list', e('title', 'in', 'a')],
  ])('%s', (_name, condition) => {
    expect(() => compile(condition)).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.malformed_request' }),
    );
  });

  test('an unknown relation and a relation to an unknown entity', () => {
    const where = e('name', 'eq', 'x');
    expect(() => compile({ op: 'some', relation: 'nope', where })).toThrow(
      expect.objectContaining({ code: 'core.malformed_request' }),
    );
    expect(() => compile({ op: 'some', relation: 'team.nope', where })).toThrow(
      expect.objectContaining({ code: 'core.malformed_request' }),
    );
    const context = contextFor(note);
    expect(() =>
      compileCondition(
        { ...context, entities: () => undefined },
        { op: 'some', relation: 'team', where },
      ),
    ).toThrow(expect.objectContaining({ code: 'core.malformed_request' }));
  });
});
