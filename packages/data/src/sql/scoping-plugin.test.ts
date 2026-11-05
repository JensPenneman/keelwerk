import type { StorageScope } from '@keelwerk/core';
import { sql } from 'kysely';
import { describe, expect, test } from 'vitest';
import { dummyDb } from '../../test/support/dummy-db.ts';
import { refused } from '../../test/support/refused.ts';
import { scopedDb } from '../../test/support/scoped-db.ts';
import { tenantId } from '../../test/support/scoping-tenant-id.ts';
import { commandReceiptDescriptor } from './postgres/command-receipt-descriptor.ts';
import { ScopingPlugin } from './scoping-plugin.ts';
import { sqlEntityIndex } from './sql-entity-index.ts';
import { sqlUnitContext } from './sql-unit-context.ts';

const backendId = '00000000-0000-4000-8000-0000000000b1';

const tenant: StorageScope = { level: 'tenant', backendId, tenantId };

// biome-ignore lint/style/useNamingConvention: column names are snake case
const elsewhere = { tenant_id: 'someone-else' };
// biome-ignore lint/style/useNamingConvention: column names are snake case
const here = { tenant_id: tenantId };

describe('select', () => {
  const db = scopedDb(tenant);

  test('the predicate goes into WHERE, after the existing filter in parentheses', () => {
    const compiled = db
      .selectFrom('app.notes as n')
      .select('n.id')
      .where(sql<boolean>`n.a = 1 or n.b = 2`)
      .compile();
    expect(compiled.sql).toBe(
      'select "n"."id" from "app"."notes" as "n" where (n.a = 1 or n.b = 2) and "n"."tenant_id" = $1',
    );
    expect(compiled.parameters).toEqual([tenantId]);
  });

  test('a table without alias is referenced by its qualified name', () => {
    expect(db.selectFrom('app.notes').select('id').compile().sql).toBe(
      'select "id" from "app"."notes" where "app"."notes"."tenant_id" = $1',
    );
  });

  test('every table of a join is scoped, in ON so outer joins stay outer', () => {
    const compiled = db
      .selectFrom('app.notes as n')
      .leftJoin('app.members as m', 'm.note_id', 'n.id')
      .innerJoin('app.members as k', 'k.note_id', 'n.id')
      .select('n.id')
      .compile();
    expect(compiled.sql).toBe(
      'select "n"."id" from "app"."notes" as "n" ' +
        'left join "app"."members" as "m" on "m"."note_id" = "n"."id" and "m"."tenant_id" = $1 ' +
        'inner join "app"."members" as "k" on "k"."note_id" = "n"."id" and "k"."tenant_id" = $2 ' +
        'where "n"."tenant_id" = $3',
    );
  });

  test('a join with an OR condition keeps its own grouping, the scope applies to the whole', () => {
    const compiled = db
      .selectFrom('app.notes as n')
      .innerJoin('app.members as m', (join) =>
        join.on((eb) =>
          eb.or([eb('m.team_id', '=', eb.ref('n.team_id')), eb('m.user_id', '=', 'x')]),
        ),
      )
      .select('n.id')
      .compile();
    expect(compiled.sql).toBe(
      'select "n"."id" from "app"."notes" as "n" inner join "app"."members" as "m" ' +
        'on ("m"."team_id" = "n"."team_id" or "m"."user_id" = $1) and "m"."tenant_id" = $2 ' +
        'where "n"."tenant_id" = $3',
    );
    const raw = db
      .selectFrom('app.notes as n')
      .innerJoin('app.members as m', (join) => join.on(sql<boolean>`m.a = 1 or m.b = 2`))
      .select('n.id')
      .compile();
    expect(raw.sql).toContain('on (m.a = 1 or m.b = 2) and "m"."tenant_id" = $1');
  });

  test('subqueries, derived tables and set operations are scoped', () => {
    const db2 = scopedDb(tenant);
    const inner = db2.selectFrom('app.members as m').select('m.note_id');
    const compiled = db2
      .selectFrom('app.notes as n')
      .select('n.id')
      .where('n.id', 'in', inner)
      .union(db2.selectFrom('app.notes as u').select('u.id'))
      .compile();
    expect(compiled.sql.match(/tenant_id" = \$/g)).toHaveLength(3);
    const derived = db2
      .selectFrom(db2.selectFrom('app.notes as x').select('x.id').as('d'))
      .selectAll()
      .compile();
    expect(derived.sql).toContain('"x"."tenant_id" = $1');
  });

  test('CTEs are scoped inside, and their names are not tables', () => {
    const compiled = scopedDb(tenant)
      .with('mine', (qb) => qb.selectFrom('app.notes as n').select('n.id'))
      .selectFrom('mine')
      .selectAll()
      .compile();
    expect(compiled.sql).toBe(
      'with "mine" as (select "n"."id" from "app"."notes" as "n" where "n"."tenant_id" = $1) select * from "mine"',
    );
  });

  test('a CTE named like a real table does not hide it inside its own definition', () => {
    const open = dummyDb().withPlugin(
      new ScopingPlugin({
        scope: tenant,
        scoped: [{ schema: null, name: 'notes', column: 'tenant_id' }],
      }),
    );
    const compiled = open
      .with('notes', (qb) => qb.selectFrom('notes').select('id'))
      .selectFrom('notes')
      .selectAll()
      .compile();
    expect(compiled.sql).toBe(
      'with "notes" as (select "id" from "notes" where "notes"."tenant_id" = $1) select * from "notes"',
    );
  });

  test('a refused statement does not leave its CTE names visible to the next one', () => {
    const open = dummyDb().withPlugin(
      new ScopingPlugin({
        scope: tenant,
        scoped: [{ schema: null, name: 'books', column: 'tenant_id' }],
      }),
    );
    const refusedWith = open
      .with('books', (qb) => qb.selectFrom('books').select('id'))
      .with('x', (qb) => qb.selectFrom(sql`other`.as('r')).selectAll())
      .selectFrom('x')
      .selectAll();
    expect(() => refusedWith.compile()).toThrow(refused);
    expect(open.selectFrom('books').selectAll().compile().sql).toBe(
      'select * from "books" where "books"."tenant_id" = $1',
    );
  });

  test('statements already scoped are not scoped twice', () => {
    const base = scopedDb(tenant);
    const inner = base.selectFrom('app.members as m').select('m.note_id');
    const compiled = base
      .selectFrom('app.notes as n')
      .select('n.id')
      .where('n.id', 'in', inner)
      .compile();
    expect(compiled.sql.match(/"m"."tenant_id"/g)).toHaveLength(1);
  });

  test('a table nobody registered, and a raw table source, are refused', () => {
    expect(() => scopedDb(tenant).selectFrom('app.other').selectAll().compile()).toThrow(refused);
    expect(() => scopedDb(tenant).selectFrom(sql`app.notes`.as('r')).selectAll().compile()).toThrow(
      refused,
    );
  });

  test('an unscoped table needs no predicate', () => {
    expect(scopedDb(tenant).selectFrom('app.globals').selectAll().compile().sql).toBe(
      'select * from "app"."globals"',
    );
  });
});

describe('scope levels', () => {
  test('a tenant unit may not touch backend tables, nor a backend unit tenant tables', () => {
    expect(() => scopedDb(tenant).selectFrom('app.settings').selectAll().compile()).toThrow(
      refused,
    );
    const backend: StorageScope = { level: 'backend', backendId };
    expect(() => scopedDb(backend).selectFrom('app.notes').selectAll().compile()).toThrow(refused);
    const compiled = scopedDb(backend).selectFrom('app.settings as s').selectAll().compile();
    expect(compiled.sql).toBe('select * from "app"."settings" as "s" where "s"."backend_id" = $1');
    expect(compiled.parameters).toEqual([backendId]);
  });

  test('scope_id holds the tenant, backend or deployment id of the unit', () => {
    const read = (scope: StorageScope, deploymentId?: string) =>
      scopedDb(scope, deploymentId).selectFrom('app.kw_positions as k').select('k.next').compile();
    expect(read(tenant)).toMatchObject({
      sql: 'select "k"."next" from "app"."kw_positions" as "k" where "k"."scope_id" = $1',
      parameters: [tenantId],
    });
    expect(read({ level: 'backend', backendId }).parameters).toEqual([backendId]);
    expect(read({ level: 'deployment' }, 'd-1').parameters).toEqual(['d-1']);
    expect(() => read({ level: 'deployment' })).toThrow(refused);
  });

  test('an invocation entity is scoped on scope_id at every level', () => {
    const receipt = commandReceiptDescriptor();
    const deploymentId = '00000000-0000-4000-8000-0000000000d1';
    const read = (scope: StorageScope) =>
      sqlUnitContext({
        namespace: { id: 'n', placementId: 'p', appId: 'a', tenantId: null, root: 'app' },
        scope,
        readOnly: true,
        deploymentId,
        clock: { now: () => Temporal.Instant.fromEpochMilliseconds(0) },
        keyWrapper: undefined,
        entities: sqlEntityIndex(),
        db: dummyDb(),
      })
        .scopedDb([receipt])
        .selectFrom('app.core__command_receipt as r')
        .select('r.id')
        .compile();
    const sqlText =
      'select "r"."id" from "app"."core__command_receipt" as "r" where "r"."scope_id" = $1';
    expect(read(tenant)).toMatchObject({ sql: sqlText, parameters: [tenantId] });
    expect(read({ level: 'backend', backendId })).toMatchObject({
      sql: sqlText,
      parameters: [backendId],
    });
    expect(read({ level: 'deployment' })).toMatchObject({
      sql: sqlText,
      parameters: [deploymentId],
    });
  });

  test('a deployment unit reaches unscoped tables only', () => {
    const deployment: StorageScope = { level: 'deployment' };
    expect(() => scopedDb(deployment).selectFrom('app.notes').selectAll().compile()).toThrow(
      refused,
    );
    expect(scopedDb(deployment).selectFrom('app.globals').selectAll().compile().sql).toBe(
      'select * from "app"."globals"',
    );
  });

  test('a namespace unit passes through, schema statements included', () => {
    const namespace: StorageScope = { level: 'namespace', reason: 'migrate' };
    expect(scopedDb(namespace).selectFrom('app.notes').selectAll().compile().sql).toBe(
      'select * from "app"."notes"',
    );
    expect(
      scopedDb(namespace).schema.createTable('app.fresh').addColumn('a', 'text').compile().sql,
    ).toBe('create table "app"."fresh" ("a" text)');
  });

  test('other statements cannot be inspected and are refused in a scoped unit', () => {
    expect(() =>
      scopedDb(tenant).schema.createTable('app.fresh').addColumn('a', 'text').compile(),
    ).toThrow(refused);
    expect(() => scopedDb(tenant).schema.dropTable('app.notes').compile()).toThrow(refused);
  });
});

describe('update and delete', () => {
  const db = scopedDb(tenant);

  test('an update carries the predicate', () => {
    const compiled = db
      .updateTable('app.notes')
      .set({ title: 'x' })
      .where('id', '=', 'a')
      .compile();
    expect(compiled.sql).toBe(
      'update "app"."notes" set "title" = $1 where ("id" = $2) and "app"."notes"."tenant_id" = $3',
    );
    expect(compiled.parameters).toEqual(['x', 'a', tenantId]);
  });

  test('an update without a filter is scoped too', () => {
    expect(db.updateTable('app.notes').set({ title: 'x' }).compile().sql).toBe(
      'update "app"."notes" set "title" = $1 where "app"."notes"."tenant_id" = $2',
    );
  });

  test('an update may not move a row to another scope', () => {
    expect(() => db.updateTable('app.notes').set(elsewhere).compile()).toThrow(refused);
    expect(db.updateTable('app.notes').set(here).compile().parameters).toEqual([
      tenantId,
      tenantId,
    ]);
  });

  test('an update from another table scopes both', () => {
    const compiled = db
      .updateTable('app.notes as n')
      .from('app.members as m')
      .set({ title: 'x' })
      .whereRef('m.note_id', '=', 'n.id')
      .compile();
    expect(compiled.sql).toContain('"n"."tenant_id" = $2 and "m"."tenant_id" = $3');
  });

  test('a delete carries the predicate, a returning clause does not change that', () => {
    const compiled = db.deleteFrom('app.notes').where('id', '=', 'a').returning('id').compile();
    expect(compiled.sql).toBe(
      'delete from "app"."notes" where ("id" = $1) and "app"."notes"."tenant_id" = $2 returning "id"',
    );
  });

  test('a delete in a CTE is scoped', () => {
    const compiled = db
      .with('gone', (qb) => qb.deleteFrom('app.notes').returning('id'))
      .selectFrom('gone')
      .selectAll()
      .compile();
    expect(compiled.sql).toContain(
      'delete from "app"."notes" where "app"."notes"."tenant_id" = $1',
    );
  });
});
