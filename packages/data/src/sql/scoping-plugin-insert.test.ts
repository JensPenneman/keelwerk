import type { StorageScope } from '@keelwerk/core';
import type { ExpressionBuilder } from 'kysely';
import { sql } from 'kysely';
import { describe, expect, test } from 'vitest';
import { refused } from '../../test/support/refused.ts';
import { scopedDb } from '../../test/support/scoped-db.ts';
import { tenantId } from '../../test/support/scoping-tenant-id.ts';
import type { SqlDb } from './sql-db.ts';

const tenant: StorageScope = {
  level: 'tenant',
  backendId: '00000000-0000-4000-8000-0000000000b1',
  tenantId,
};

// biome-ignore lint/style/useNamingConvention: column names are snake case
const elsewhere = { tenant_id: 'someone-else' };
// biome-ignore lint/style/useNamingConvention: column names are snake case
const here = { tenant_id: tenantId };
// biome-ignore lint/style/useNamingConvention: column names are snake case
const unchecked = { tenant_id: sql`current_setting('x')` };

describe('insert', () => {
  const db = scopedDb(tenant);

  test('the scope column and value are added to every row', () => {
    const compiled = db
      .insertInto('app.notes')
      .values([{ id: 'a' }, { id: 'b' }])
      .compile();
    expect(compiled.sql).toBe(
      'insert into "app"."notes" ("id", "tenant_id") values ($1, $2), ($3, $4)',
    );
    expect(compiled.parameters).toEqual(['a', tenantId, 'b', tenantId]);
  });

  test('a row that names the unit’s scope passes', () => {
    const compiled = db
      .insertInto('app.notes')
      .values({ id: 'a', ...here })
      .compile();
    expect(compiled.parameters).toEqual(['a', tenantId]);
  });

  test('a row carrying another scope is an error', () => {
    expect(() =>
      db
        .insertInto('app.notes')
        .values({ id: 'a', ...elsewhere })
        .compile(),
    ).toThrow(refused);
    expect(() =>
      db
        .insertInto('app.notes')
        .values([
          { id: 'a', ...here },
          { id: 'b', ...elsewhere },
        ])
        .compile(),
    ).toThrow(refused);
  });

  test('a scope that is an expression cannot be checked and is refused', () => {
    expect(() =>
      db
        .insertInto('app.notes')
        .values({ id: 'a', ...unchecked })
        .compile(),
    ).toThrow(refused);
  });

  test('an insert from a query scopes the inner select and carries the unit’s scope value', () => {
    const compiled = db
      .insertInto('app.notes')
      .columns(['id', 'tenant_id'])
      .expression((eb) =>
        eb.selectFrom('app.members as m').select(['m.id', eb.val(tenantId).as('tenant_id')]),
      )
      .compile();
    expect(compiled.sql).toBe(
      'insert into "app"."notes" ("id", "tenant_id") ' +
        'select "m"."id", $1 as "tenant_id" from "app"."members" as "m" where "m"."tenant_id" = $2',
    );
    expect(compiled.parameters).toEqual([tenantId, tenantId]);
  });

  test('an insert from a query that does not provide the unit’s scope is refused', () => {
    const from = (eb: ExpressionBuilder<SqlDb, never>) => eb.selectFrom('app.members as m');
    expect(() =>
      db
        .insertInto('app.notes')
        .columns(['id'])
        .expression((eb) => from(eb).select('m.id'))
        .compile(),
    ).toThrow(refused);
    expect(() =>
      db
        .insertInto('app.notes')
        .columns(['id', 'tenant_id'])
        .expression((eb) => from(eb).select(['m.id', eb.val('someone-else').as('tenant_id')]))
        .compile(),
    ).toThrow(refused);
    expect(() =>
      db
        .insertInto('app.notes')
        .columns(['id', 'tenant_id'])
        .expression((eb) => from(eb).select(['m.id', 'm.tenant_id']))
        .compile(),
    ).toThrow(refused);
    expect(() =>
      db
        .insertInto('app.notes')
        .columns(['id', 'tenant_id'])
        .expression((eb) =>
          from(eb).select(['m.id', sql<string>`current_setting('x')`.as('tenant_id')]),
        )
        .compile(),
    ).toThrow(refused);
  });

  test('a conflict update that moves the row is refused', () => {
    expect(() =>
      db
        .insertInto('app.notes')
        .values({ id: 'a' })
        .onConflict((oc) => oc.column('id').doUpdateSet(elsewhere))
        .compile(),
    ).toThrow(refused);
    expect(
      db
        .insertInto('app.notes')
        .values({ id: 'a' })
        .onConflict((oc) => oc.column('id').doUpdateSet({ id: 'b' }))
        .compile().sql,
    ).toContain('on conflict ("id") do update set "id" = $3');
  });

  test('the update branch of an upsert is scoped too', () => {
    const compiled = db
      .insertInto('app.notes')
      .values({ id: 'a' })
      .onConflict((oc) => oc.column('id').doUpdateSet({ title: 't' }))
      .compile();
    expect(compiled.sql).toBe(
      'insert into "app"."notes" ("id", "tenant_id") values ($1, $2) ' +
        'on conflict ("id") do update set "title" = $3 where "app"."notes"."tenant_id" = $4',
    );
    expect(compiled.parameters).toEqual(['a', tenantId, 't', tenantId]);
    const filtered = db
      .insertInto('app.notes')
      .values({ id: 'a' })
      .onConflict((oc) =>
        oc
          .column('id')
          .doUpdateSet({ title: 't' })
          .where(sql<boolean>`"app"."notes"."a" = 1 or "app"."notes"."b" = 2`),
      )
      .compile();
    expect(filtered.sql).toContain(
      'where ("app"."notes"."a" = 1 or "app"."notes"."b" = 2) and "app"."notes"."tenant_id" = $4',
    );
  });
});
