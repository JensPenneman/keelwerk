import { sql } from 'kysely';
import { describe, expect, test } from 'vitest';
import { contextFor } from '../../test/support/context-for.ts';
import { dummyDb } from '../../test/support/dummy-db.ts';
import { note } from '../../test/support/note.ts';
import { compileSort } from './compile-sort.ts';
import { postgresCodecs } from './postgres/postgres-codecs.ts';

const table = contextFor(note).table;

function orderBy(sort: Parameters<typeof compileSort>[1], reverse = false): string {
  const compiled = compileSort(table, sort, postgresCodecs);
  let query = dummyDb().selectFrom(table.from).select(sql.lit(1).as('one'));
  for (const item of compiled.orderBy(reverse)) query = query.orderBy(item);
  return query.compile().sql.replace(/^.* order by /, '');
}

describe('compileSort', () => {
  test('ascending puts absent values last, descending first, and ends with id', () => {
    expect(orderBy([{ field: 'title', direction: 'asc' }])).toBe(
      '"t"."title" asc nulls last, "t"."id" asc nulls last',
    );
    expect(orderBy([{ field: 'count', direction: 'desc' }])).toBe(
      '"t"."count" desc nulls first, "t"."id" asc nulls last',
    );
  });

  test('no sort is id order', () => {
    expect(orderBy(undefined)).toBe('"t"."id" asc nulls last');
  });

  test('reversing flips every direction and its nulls', () => {
    expect(orderBy([{ field: 'title', direction: 'asc' }], true)).toBe(
      '"t"."title" desc nulls first, "t"."id" desc nulls first',
    );
  });

  test('an id the request names stays where it is and drops the keys after it', () => {
    const compiled = compileSort(
      table,
      [
        { field: 'id', direction: 'desc' },
        { field: 'title', direction: 'asc' },
      ],
      postgresCodecs,
    );
    expect(compiled.keys.map((key) => [key.field, key.direction])).toEqual([['id', 'desc']]);
  });

  test('the resolved keys carry their column and codec', () => {
    const compiled = compileSort(table, [{ field: 'at', direction: 'asc' }], postgresCodecs);
    expect(compiled.keys.map((key) => key.column.column)).toEqual(['at', 'id']);
    expect(compiled.keys[0]?.codec.sqlType).toBe('timestamptz');
  });

  test.each([
    ['an unknown field', 'nope', 'validation', 'core.malformed_request'],
    ['a json field', 'data', 'validation', 'core.malformed_request'],
    ['a set', 'tags', 'validation', 'core.malformed_request'],
    ['bytes', 'blob', 'validation', 'core.malformed_request'],
    ['a sealed credential', 'secret', 'validation', 'core.malformed_request'],
    ['a personal field', 'email', 'unsupported', 'core.personal_operator'],
  ])('%s cannot be a sort key', (_name, field, kind, code) => {
    expect(() => compileSort(table, [{ field, direction: 'asc' }], postgresCodecs)).toThrow(
      expect.objectContaining({ kind, code }),
    );
  });

  test('a field named twice is refused', () => {
    expect(() =>
      compileSort(
        table,
        [
          { field: 'title', direction: 'asc' },
          { field: 'title', direction: 'desc' },
        ],
        postgresCodecs,
      ),
    ).toThrow(expect.objectContaining({ code: 'core.malformed_request' }));
  });
});
