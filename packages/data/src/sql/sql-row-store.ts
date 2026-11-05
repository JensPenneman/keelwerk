import type {
  Condition,
  EntityDescriptor,
  KeyedUpdate,
  RowPage,
  RowQuery,
  RowStore,
  StorageRow,
} from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import type { Expression, SelectQueryBuilder } from 'kysely';
import { sql } from 'kysely';
import { compileCondition } from './compile-condition.ts';
import { compileRowQuery } from './compile-row-query.ts';
import { compileSort } from './compile-sort.ts';
import { entityTable } from './entity-table.ts';
import { keysetCondition } from './keyset-condition.ts';
import { malformedQuery } from './malformed-query.ts';
import { postgresCodecs } from './postgres/postgres-codecs.ts';
import { versionConflict } from './postgres/version-conflict.ts';
import { sqlConditionContext } from './sql-condition-context.ts';
import type { SqlDb } from './sql-db.ts';
import { sqlEncodeRow } from './sql-encode-row.ts';
import { sqlGuard } from './sql-guard.ts';
import { sqlPositionExpression } from './sql-position-expression.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columns a state row update clears when the new row leaves them out. */
const clearedSystemFields = ['archivedAt'] as const;

type Rows = SelectQueryBuilder<SqlDb, string, Record<string, unknown>>;

/**
 * The rows of one unit's scope over SQL (14.3.2, 14.3.4): the query compiler of this package, the
 * scoping plugin on every statement, positioned reads (S-19), versioned updates and the
 * reference semantics of the in-memory adapter (counts and existence leave archived rows out,
 * unique violations are `conflict`).
 */
export function sqlRowStore(ctx: SqlUnitContext): RowStore {
  const maxOffset = 10_000;

  const find = async (entity: EntityDescriptor, query: RowQuery): Promise<RowPage> => {
    const db = ctx.scopedDb([entity]);
    const plan = compileRowQuery({
      ...sqlConditionContext(ctx, entity),
      db,
      query,
      maxOffset,
      ...(query.positioned === true ? { position: sqlPositionExpression(ctx) } : {}),
    });
    return sqlGuard(async () => {
      const rows = await plan.select.execute();
      const total = plan.count === undefined ? undefined : await plan.count.executeTakeFirst();
      return plan.read(rows, total);
    });
  };

  const archivedFree = (entity: EntityDescriptor): Expression<boolean> =>
    sql<boolean>`${sql.ref(entityTable(entity, ctx.namespace.root, 't').reference('archived_at'))} is null`;

  const uuids = (ids: readonly string[]): string[] => [
    ...new Set(ids.filter((id) => uuidPattern.test(id))),
  ];

  const idsAmong = async (
    entity: EntityDescriptor,
    ids: readonly string[],
    ...extra: Expression<boolean>[]
  ): Promise<ReadonlySet<string>> => {
    const wanted = uuids(ids);
    const table = entityTable(entity, ctx.namespace.root, 't');
    let query: Rows = ctx
      .scopedDb([entity])
      .selectFrom(table.from)
      .select(sql<string>`${sql.ref(table.reference('id'))}::text`.as('id'))
      .where(
        wanted.length === 0
          ? sql<boolean>`false`
          : sql<boolean>`${sql.ref(table.reference('id'))} in (${sql.join(wanted)})`,
      );
    if (wanted.length === 0) {
      // No ids to look up: compiling still runs the scoping plugin, so a scope that may not
      // reach this entity is refused all the same.
      query.compile();
      return new Set();
    }
    for (const predicate of extra) query = query.where(predicate);
    const found = await sqlGuard(async () => query.execute());
    return new Set(found.map((row) => String(row.id)));
  };

  const countBefore = async (
    entity: EntityDescriptor,
    query: Omit<RowQuery, 'page'>,
    id: string,
  ): Promise<number> => {
    const table = entityTable(entity, ctx.namespace.root, 't');
    const sort = compileSort(table, query.sort, postgresCodecs);
    const anchorPage = await find(entity, {
      where: { op: 'eq', field: 'id', value: id },
      includeArchived: true,
      select: sort.keys.map((key) => key.field),
    });
    const anchor = anchorPage.rows[0];
    if (anchor === undefined) throw errors.not_found(`${entity.ref} has no row ${id}`);
    const before = keysetCondition(
      sort,
      table,
      sort.keys.slice(0, -1).map((key) => anchor[key.field] ?? null),
      id,
      'before',
    );
    let counted = ctx
      .scopedDb([entity])
      .selectFrom(table.from)
      .select(sql<string>`count(*)::text`.as('total'))
      .where(before);
    if (query.includeArchived !== true) counted = counted.where(archivedFree(entity));
    if (query.where !== undefined) {
      counted = counted.where(compileCondition(sqlConditionContext(ctx, entity), query.where));
    }
    const row = await sqlGuard(async () => counted.executeTakeFirst());
    return Number(String(row?.total ?? 0));
  };

  const insert = async (entity: EntityDescriptor, rows: readonly StorageRow[]): Promise<void> => {
    ctx.writable();
    if (rows.length === 0) return;
    const table = entityTable(entity, ctx.namespace.root, 't');
    const encoded = rows.map((row) => sqlEncodeRow(table, row));
    const db = ctx.scopedDb([entity]);
    await sqlGuard(async () => {
      await db.insertInto(ctx.table(entity.table)).values(encoded).execute();
    });
  };

  const update = async (
    entity: EntityDescriptor,
    updates: readonly KeyedUpdate[],
  ): Promise<void> => {
    ctx.writable();
    const table = entityTable(entity, ctx.namespace.root, 't');
    const db = ctx.scopedDb([entity]);
    const cleared = [
      ...Object.keys(entity.fields),
      ...Object.keys(entity.derivedIndexes),
      ...clearedSystemFields,
    ];
    // The scope column follows the entity's tenancy; a field that merely shares its name is data.
    const skipped = new Set([
      'id',
      ...(table.scopeColumn === null
        ? []
        : [table.scopeColumn === 'tenant_id' ? 'tenantId' : 'backendId']),
    ]);
    for (const change of updates) {
      // The complete new state: what the row leaves out is cleared, the id and the scope stay.
      const values = sqlEncodeRow(table, change.values, skipped);
      for (const name of cleared) {
        const column = table.column(name);
        if (column !== undefined && !(column.column in values)) {
          values[column.column] = null;
        }
      }
      const result = await sqlGuard(async () =>
        db
          .updateTable(ctx.table(entity.table))
          .set(values)
          .where('id', '=', change.id)
          .where('version', '=', change.expectedVersion)
          .executeTakeFirst(),
      );
      if (result.numUpdatedRows === 0n) throw versionConflict(entity, change.id);
    }
  };

  return {
    find,
    findOne: async (entity, query) => {
      const page = await find(entity, { ...query, page: { first: 1 } });
      return page.rows[0];
    },
    count: async (entity, where) => {
      let counted = ctx
        .scopedDb([entity])
        .selectFrom(entityTable(entity, ctx.namespace.root, 't').from)
        .select(sql<string>`count(*)::text`.as('total'))
        .where(archivedFree(entity));
      if (where !== undefined) {
        counted = counted.where(compileCondition(sqlConditionContext(ctx, entity), where));
      }
      const row = await sqlGuard(async () => counted.executeTakeFirst());
      return Number(String(row?.total ?? 0));
    },
    exists: async (entity, ids) => idsAmong(entity, ids, archivedFree(entity)),
    matching: async (entity: EntityDescriptor, ids: readonly string[], where: Condition) =>
      idsAmong(entity, ids, compileCondition(sqlConditionContext(ctx, entity), where)),
    insert,
    update,
    purge: async (entity, ids) => {
      ctx.writable();
      const wanted = uuids(ids);
      if (wanted.length === 0) return 0;
      const result = await sqlGuard(async () =>
        ctx
          .scopedDb([entity])
          .deleteFrom(ctx.table(entity.table))
          .where(sql<boolean>`id in (${sql.join(wanted)})`)
          .executeTakeFirst(),
      );
      return Number(result.numDeletedRows);
    },
    lock: async (entity, query, options) => {
      ctx.writable();
      if (query.positioned === true) {
        throw malformedQuery(
          'a locked load reads its position with the event store, not with the row statement',
        );
      }
      const plan = compileRowQuery({
        ...sqlConditionContext(ctx, entity),
        db: ctx.scopedDb([entity]),
        query: { ...query, forUpdate: false },
        maxOffset,
      });
      let locked = options.mode === 'update' ? plan.select.forUpdate() : plan.select.forShare();
      if (options.skipLocked === true) locked = locked.skipLocked();
      if (options.noWait === true) locked = locked.noWait();
      return sqlGuard(async () => plan.read(await locked.execute()).rows);
    },
    countBefore,
  };
}
