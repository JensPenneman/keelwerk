import type {
  Condition,
  EntityDescriptor,
  KeyedUpdate,
  RowPage,
  RowQuery,
  RowStore,
  StorageRow,
} from '@keelwerk/core';
import { errors, KeelwerkError } from '@keelwerk/core';
import { compileSort } from '../sql/compile-sort.ts';
import { entityTable } from '../sql/entity-table.ts';
import { malformedQuery } from '../sql/malformed-query.ts';
import { memoryCandidates } from './memory-candidates.ts';
import { memoryCheckCondition } from './memory-check-condition.ts';
import { memoryCheckPurge } from './memory-check-purge.ts';
import { memoryCheckReferences } from './memory-check-references.ts';
import { memoryCheckUnique } from './memory-check-unique.ts';
import { memoryCodecs } from './memory-codecs.ts';
import { memoryCompareRows } from './memory-compare-rows.ts';
import { memoryEvaluate } from './memory-evaluate.ts';
import { memoryPage } from './memory-page.ts';
import { memoryPrepareRow } from './memory-prepare-row.ts';
import { memoryScopePosition } from './memory-scope-position.ts';
import { memorySearch } from './memory-search.ts';
import { memorySource } from './memory-source.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** The most a position page may skip (the default of PostgreSQL, 14.3.5). */
const maxOffset = 10_000;

function versionMismatch(entity: EntityDescriptor, id: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'conflict',
    code: 'core.version_mismatch',
    message: 'The row changed since it was read.',
    details: { entity: entity.ref, id },
  });
}

/** The rows of one unit's scope: the reference implementation of `RowStore` (14.3.2, 14.3.4). */
export function memoryRowStore(ctx: MemoryUnitContext): RowStore {
  const find = async (entity: EntityDescriptor, query: RowQuery): Promise<RowPage> => {
    if (query.positioned === true && query.forUpdate === true) {
      throw malformedQuery(
        'a locked load reads its position with the event store, not with the row statement',
      );
    }
    const candidates = memoryCandidates(ctx, entity, query.where, query.includeArchived === true);
    const page = memoryPage(entity, candidates, {
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      ...(query.page === undefined ? {} : { page: query.page }),
      ...(query.select === undefined ? {} : { select: query.select }),
      ...(query.total === undefined ? {} : { total: query.total }),
      ...(query.where === undefined ? {} : { where: query.where }),
      maxOffset,
    });
    return query.positioned === true ? { ...page, position: memoryScopePosition(ctx) } : page;
  };
  const insert = async (entity: EntityDescriptor, rows: readonly StorageRow[]): Promise<void> => {
    ctx.writable();
    const scopeId = ctx.reach(entity);
    const stored = ctx.rows(entity);
    const staged = new Map<string, StorageRow>();
    for (const input of rows) {
      const row = memoryPrepareRow(entity, input, scopeId);
      const id = String(row.id);
      if (stored.has(id) || staged.has(id)) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.conflict',
          message: `${entity.ref} already has a row with id ${id}`,
          details: { entity: entity.ref, id },
        });
      }
      memoryCheckUnique(entity, row, [...stored.values(), ...staged.values()]);
      staged.set(id, row);
    }
    for (const row of staged.values()) memoryCheckReferences(ctx, entity, row, staged);
    const table = ctx.writeRows(entity);
    for (const [id, row] of staged) table.set(id, row);
  };
  const update = async (
    entity: EntityDescriptor,
    updates: readonly KeyedUpdate[],
  ): Promise<void> => {
    ctx.writable();
    const scopeId = ctx.reach(entity);
    const stored = ctx.rows(entity);
    const staged = new Map<string, StorageRow>();
    const current = (id: string): StorageRow | undefined => staged.get(id) ?? stored.get(id);
    for (const change of updates) {
      const existing = current(change.id);
      if (existing === undefined || existing.version !== change.expectedVersion) {
        throw versionMismatch(entity, change.id);
      }
      const row = memoryPrepareRow(entity, change.values, scopeId);
      if (row.id !== change.id) throw malformedQuery('an update cannot change the row id');
      const others = [...stored.values()].filter((other) => !staged.has(String(other.id)));
      memoryCheckUnique(entity, row, [...others, ...staged.values()]);
      staged.set(change.id, row);
    }
    for (const row of staged.values()) memoryCheckReferences(ctx, entity, row, staged);
    const table = ctx.writeRows(entity);
    for (const [id, row] of staged) table.set(id, row);
  };
  const matching = async (
    entity: EntityDescriptor,
    ids: readonly string[],
    where: Condition,
  ): Promise<ReadonlySet<string>> => {
    memoryCheckCondition(entity, where, ctx.entity, ctx.reach);
    const stored = ctx.rows(entity);
    const source = memorySource(ctx);
    const found = new Set<string>();
    for (const id of ids) {
      const row = stored.get(id);
      if (row !== undefined && memoryEvaluate(source, entity, where, row)) found.add(id);
    }
    return found;
  };
  const countBefore = async (
    entity: EntityDescriptor,
    query: Omit<RowQuery, 'page'>,
    id: string,
  ): Promise<number> => {
    const anchor = ctx.rows(entity).get(id);
    if (anchor === undefined) throw errors.not_found(`${entity.ref} has no row ${id}`);
    const sort = compileSort(entityTable(entity, null, 'e'), query.sort, memoryCodecs);
    return memoryCandidates(ctx, entity, query.where, query.includeArchived === true).filter(
      (row) => memoryCompareRows(sort.keys, row, anchor) < 0,
    ).length;
  };
  return {
    find,
    findOne: async (entity, query) => {
      const page = await find(entity, { ...query, page: { first: 1 } });
      return page.rows[0];
    },
    count: async (entity, where) => memoryCandidates(ctx, entity, where, false).length,
    exists: async (entity, ids) => {
      const stored = ctx.rows(entity);
      return new Set(
        ids.filter((id) => {
          const row = stored.get(id);
          return row !== undefined && (row.archivedAt === undefined || row.archivedAt === null);
        }),
      );
    },
    matching,
    insert,
    update,
    purge: async (entity, ids) => {
      ctx.writable();
      const present = [...new Set(ids)].filter((id) => ctx.rows(entity).has(id));
      if (present.length === 0) return 0;
      memoryCheckPurge(ctx, entity, new Set(present));
      const table = ctx.writeRows(entity);
      for (const id of present) table.delete(id);
      return present.length;
    },
    countBefore,
    search: (entity, request) => memorySearch(ctx, entity, request, maxOffset),
  };
}
