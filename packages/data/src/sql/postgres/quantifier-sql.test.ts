import type { Condition } from '@keelwerk/core';
import { sql } from 'kysely';
import { describe, expect, test } from 'vitest';
import { contextFor } from '../../../test/support/context-for.ts';
import { dummyDb } from '../../../test/support/dummy-db.ts';
import { note } from '../../../test/support/note.ts';
import { tenantScope } from '../../../test/support/tenant-scope.ts';
import { compileCondition } from '../compile-condition.ts';

const prefix = 'select 1 as "one" from "app"."app__note" as "t" where ';
const tenant = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';

function compile(condition: Condition): { sql: string; parameters: readonly unknown[] } {
  const context = contextFor(note);
  const compiled = dummyDb(tenantScope)
    .selectFrom(context.table.from)
    .select(sql.lit(1).as('one'))
    .where(compileCondition(context, condition))
    .compile();
  return { sql: compiled.sql.replace(prefix, ''), parameters: compiled.parameters };
}

const red: Condition = { op: 'eq', field: 'name', value: 'red' };

describe('relation quantifiers', () => {
  test('some is EXISTS, with the scope predicate on the outer table and on the subquery', () => {
    expect(compile({ op: 'some', relation: 'team', where: red })).toEqual({
      sql:
        '(exists (select 1 as "one" from "app"."app__team" as "q1" where ' +
        '("q1"."id" = "t"."team_id" and "q1"."archived_at" is null and coalesce("q1"."name" = $1, false)) ' +
        'and "q1"."tenant_id" = $2)) and "t"."tenant_id" = $3',
      parameters: ['red', tenant, tenant],
    });
  });

  test('is on a to-one relation is EXISTS too', () => {
    expect(compile({ op: 'is', relation: 'team', where: red }).sql).toContain('(exists (select 1');
  });

  test('none is NOT EXISTS', () => {
    expect(compile({ op: 'none', relation: 'team', where: red }).sql).toContain(
      '(not exists (select 1 as "one" from "app"."app__team" as "q1"',
    );
  });

  test('every is NOT EXISTS of the rows that fail the where, so it holds for an empty relation', () => {
    const compiled = compile({ op: 'every', relation: 'team', where: red });
    expect(compiled.sql).toContain('(not exists (select 1');
    expect(compiled.sql).toContain('and not coalesce("q1"."name" = $1, false)');
  });

  test('a dotted path nests one subquery per hop, each scoped', () => {
    const compiled = compile({
      op: 'some',
      relation: 'team.members',
      where: { op: 'eq', field: 'role', value: 'admin' },
    });
    expect(compiled.sql).toBe(
      '(exists (select 1 as "one" from "app"."app__team" as "q1" where ' +
        '("q1"."id" = "t"."team_id" and "q1"."archived_at" is null and ' +
        'exists (select 1 as "one" from "app"."app__member" as "q2" where ' +
        '("q2"."team_id" = "q1"."id" and "q2"."archived_at" is null and coalesce("q2"."role" = $1, false)) ' +
        'and "q2"."tenant_id" = $2)) and "q1"."tenant_id" = $3)) and "t"."tenant_id" = $4',
    );
    expect(compiled.parameters).toEqual(['admin', tenant, tenant, tenant]);
  });

  test('a quantifier inside a quantifier gets its own alias and scope', () => {
    const compiled = compile({
      op: 'some',
      relation: 'team',
      where: { op: 'some', relation: 'members', where: { op: 'eq', field: 'role', value: 'a' } },
    });
    expect(compiled.sql).toContain('"app"."app__team" as "q1"');
    expect(compiled.sql).toContain('"app"."app__member" as "q2"');
    expect(compiled.sql.match(/tenant_id" = \$/g)).toHaveLength(3);
  });

  test('a to-many relation links the related rows back to this one', () => {
    expect(compile({ op: 'some', relation: 'watchers', where: { op: 'never' } }).sql).toContain(
      '"q1"."team_id" = "t"."team_id"',
    );
  });

  test('relation keys that name no field are core.malformed_request', () => {
    const broken = {
      ...note,
      relations: {
        bad: { kind: 'one', target: 'app.team', by: 'nope', to: 'teamId', contributedBy: null },
      },
    } as const;
    const context = contextFor(broken);
    expect(() => compileCondition(context, { op: 'some', relation: 'bad', where: red })).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.malformed_request' }),
    );
  });
});
