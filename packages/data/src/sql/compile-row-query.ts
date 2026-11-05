import type { Condition, RowPage, RowQuery, StorageRow } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import type { Expression, Kysely, SelectQueryBuilder } from 'kysely';
import { sql } from 'kysely';
import type { ConditionContext } from './compile-condition.ts';
import { compileCondition } from './compile-condition.ts';
import type { CompiledSort } from './compile-sort.ts';
import { compileSort } from './compile-sort.ts';
import { cursorSignature } from './cursor-signature.ts';
import { decodeCursor } from './decode-cursor.ts';
import { encodeCursor } from './encode-cursor.ts';
import type { ColumnRef, EntityTable } from './entity-table.ts';
import { keysetCondition } from './keyset-condition.ts';
import { malformedQuery } from './malformed-query.ts';
import type { SqlDb } from './sql-db.ts';
import type { ValueCodec } from './value-codec.ts';
import { windowOf } from './window-of.ts';

const positionColumn = 'kwPosition';

function internal(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'internal', code: 'core.internal', message });
}

function resolveColumn(table: EntityTable, name: string): ColumnRef {
  const column = table.column(name);
  if (column === undefined) throw malformedQuery(`${table.entity.ref} has no field ${name}`);
  return column;
}

function selectedFields(
  table: EntityTable,
  query: RowQuery,
  sort: CompiledSort,
): readonly string[] {
  const names: string[] = [...table.systemFields];
  const add = (name: string): void => {
    if (!names.includes(name)) names.push(name);
  };
  for (const name of query.select ?? Object.keys(table.entity.fields)) add(name);
  for (const key of sort.keys) add(key.field);
  return names;
}

function whereOf(request: RowQueryRequest, filter: Condition | undefined): Expression<boolean>[] {
  const parts: Expression<boolean>[] = [];
  if (request.table.archivable && request.query.includeArchived !== true) {
    parts.push(sql<boolean>`${sql.ref(request.table.reference('archived_at'))} is null`);
  }
  if (filter !== undefined) parts.push(compileCondition(request, filter));
  return parts;
}

/** The statements of a row query. */
export interface CompiledRowQuery {
  /** Selects the page's rows; columns are named after the fields. */
  readonly select: SelectQueryBuilder<SqlDb, string, Record<string, unknown>>;
  /** Present with `total`: one row, one column `total`, over the same filter and no cursor. */
  readonly count: SelectQueryBuilder<SqlDb, string, Record<string, unknown>> | undefined;
  /**
   * Turns what the statements returned into the page: decodes the values, drops the extra row
   * fetched to learn whether more follow, restores the order of a backwards or negative position
   * page, derives the page info and the cursors, and carries the scope position.
   */
  read(
    rows: readonly Readonly<Record<string, unknown>>[],
    total?: Readonly<Record<string, unknown>>,
  ): RowPage;
}

/** What `compileRowQuery` needs. */
export interface RowQueryRequest extends ConditionContext {
  /** The unit's Kysely instance, with the scoping plugin: the returned statements run through it. */
  readonly db: Kysely<SqlDb>;
  readonly query: RowQuery;
  /** Capability `positionPaging`: the largest `position` (10,000 by default on PostgreSQL). */
  readonly maxOffset?: number;
  /**
   * The scope's position counter as a scalar expression, read in the same statement as the rows
   * when the query is `positioned` (S-19); required then. The scoping
   * plugin scopes the tables inside it with the rest of the statement.
   */
  readonly position?: Expression<unknown>;
}

/**
 * Compiles a `RowQuery` against one entity (sections 14.3.2, 14.3.5): the filter, the archived
 * default, keyset paging over the sort with `id` last, position paging, `total`, `forUpdate` and
 * `positioned` (S-19). The scope predicate is not written here: the scoping plugin adds it to
 * this statement and to every subquery in it.
 */
export function compileRowQuery(request: RowQueryRequest): CompiledRowQuery {
  const { query, table, db } = request;
  const codecs = request.dialect.codecs;
  const sort = compileSort(table, query.sort, codecs);
  const window = windowOf(query.page, request.maxOffset ?? 10_000);
  const signature = cursorSignature(sort.keys, query.where);
  const keyFields = sort.keys.map((key) => key.column.field);
  const cursorFields = keyFields.slice(0, -1);
  const positioned = query.positioned === true;
  if (positioned && request.position === undefined) {
    throw internal('a positioned query needs the position expression of its scope');
  }
  if (positioned && query.forUpdate === true) {
    throw malformedQuery(
      'a locked load reads its position with the event store, not with the row statement',
    );
  }

  const predicates = whereOf(request, query.where);
  const decodeCursorRow = (cursor: string): ReturnType<typeof decodeCursor> =>
    decodeCursor(cursor, cursorFields, signature);
  if (window.after !== undefined || window.before !== undefined) {
    const decoded = decodeCursorRow((window.after ?? window.before) as string);
    predicates.push(
      keysetCondition(
        sort,
        table,
        decoded.values,
        decoded.id,
        window.after !== undefined ? 'after' : 'before',
      ),
    );
  }

  const names = selectedFields(table, query, sort);
  const columns: { readonly name: string; readonly codec: ValueCodec }[] = names.map((name) => ({
    name,
    codec: codecs.forField(resolveColumn(table, name).field),
  }));
  const selections = names.map((name) => {
    const column = resolveColumn(table, name);
    const reference = sql.ref(table.reference(column.column));
    const codec = codecs.forField(column.field);
    return (codec.readAsText ? sql`${reference}::text` : reference).as(name);
  });

  let rows = db.selectFrom(table.from).select(selections);
  for (const predicate of predicates) rows = rows.where(predicate);
  for (const item of sort.orderBy(window.backwards)) rows = rows.orderBy(item);
  if (window.limit !== undefined) rows = rows.limit(window.limit);
  if (window.offset > 0) rows = rows.offset(window.offset);
  if (query.forUpdate === true) rows = rows.forUpdate();

  let select: CompiledRowQuery['select'] = rows;
  if (positioned) {
    let outer = db
      .selectFrom(db.selectNoFrom(sql<string>`(${request.position})::text`.as('position')).as('p'))
      .leftJoinLateral(rows.as('r'), (join) => join.onTrue())
      .selectAll('r')
      .select(sql.ref('p.position').as(positionColumn));
    for (const item of sort.orderBy(window.backwards, (key) => `r.${key.field}`)) {
      outer = outer.orderBy(item);
    }
    select = outer;
  }

  let count: CompiledRowQuery['count'];
  if (query.total === true) {
    let counted = db.selectFrom(table.from).select(sql<string>`count(*)::text`.as('total'));
    for (const predicate of whereOf(request, query.where)) counted = counted.where(predicate);
    count = counted;
  }

  const positionOf = (value: unknown): bigint => {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
      throw internal('the scope has no position counter row');
    }
    return BigInt(value);
  };
  const decodeRow = (raw: Readonly<Record<string, unknown>>): StorageRow => {
    const row: Record<string, unknown> = {};
    for (const { name, codec } of columns) {
      const stored = raw[name];
      if (stored !== null && stored !== undefined) row[name] = codec.decode(stored);
    }
    return row;
  };
  const cursorOf = (row: StorageRow): string =>
    encodeCursor(
      sort.keys.slice(0, -1).map((key) => key.field),
      sort.keys.slice(0, -1).map((key) => row[key.field] ?? null),
      String(row.id),
      signature,
    );

  return {
    select,
    count,
    read: (raw, totalRow) => {
      // A positioned statement pads an empty result with one row of nothing but the position.
      const present = positioned
        ? raw.filter((row) => row.id !== null && row.id !== undefined)
        : raw;
      const overflow = window.size !== undefined && present.length > window.size;
      const kept = window.size === undefined ? present : present.slice(0, window.size);
      const ordered = (window.backwards ? kept.toReversed() : kept).map(decodeRow);
      const first = ordered.at(0);
      const last = ordered.at(-1);
      const hasMore = window.size !== undefined && overflow;
      const forward = !window.backwards;
      const page: RowPage = {
        rows: ordered,
        pageInfo: {
          hasNextPage: forward ? hasMore : window.before !== undefined || window.offset > 0,
          hasPreviousPage: forward ? window.after !== undefined || window.offset > 0 : hasMore,
          startCursor: first === undefined ? null : cursorOf(first),
          endCursor: last === undefined ? null : cursorOf(last),
        },
        ...(totalRow === undefined ? {} : { total: Number(String(totalRow.total)) }),
        ...(positioned && raw[0] !== undefined
          ? { position: positionOf(raw[0][positionColumn]) }
          : {}),
      };
      return page;
    },
  };
}
