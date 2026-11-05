import type { Condition } from '../conditions/condition.ts';
import { errors } from '../errors/errors.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { RowPage } from '../storage/row-page.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { RowStore } from '../storage/row-store.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { checkSortable } from './check-sortable.ts';
import { fillApproximatePage } from './fill-approximate-page.ts';
import { openRow } from './open-row.ts';
import { planEncryption } from './plan-encryption.ts';
import type { PlannedCondition } from './planned-condition.ts';
import { projectRow } from './project-row.ts';
import { scanFind } from './scan-find.ts';
import { scanSelected } from './scan-selected.ts';
import { sealRow } from './seal-row.ts';
import type { SealingContext } from './sealing-context.ts';
import { verifyUnsealed } from './verify-unsealed.ts';

/**
 * The row store the kernel sees over an adapter's (14.7.9.5): writes seal personal values and
 * compute their tags, reads rewrite the condition onto the tags, unseal the rows and re-evaluate
 * the original condition on them, and a prefix takes the bounded scan of S-37. Every row that
 * leaves is plain, without tags; every row that goes in is sealed.
 */
export function sealingRows(context: SealingContext): RowStore {
  const raw = context.unit.rows;

  const planOf = (entity: EntityDescriptor, where: Condition | undefined) =>
    where === undefined ? Promise.resolve(undefined) : planEncryption(context, entity, where);

  const openAll = async (
    entity: EntityDescriptor,
    rows: readonly StorageRow[],
  ): Promise<StorageRow[]> => {
    const opened: StorageRow[] = [];
    for (const row of rows) opened.push(await openRow(context, entity, row));
    return opened;
  };

  /** The rows of a raw page, unsealed and, when the plan asks, confirmed against the original condition. */
  const settle = async (
    entity: EntityDescriptor,
    query: Pick<RowQuery, 'where' | 'select'>,
    rows: readonly StorageRow[],
    plan: PlannedCondition | undefined,
  ): Promise<readonly StorageRow[]> => {
    let opened: readonly StorageRow[] = await openAll(entity, rows);
    if (plan?.verify === true && query.where !== undefined) {
      opened = verifyUnsealed(context, entity, query.where, opened);
    }
    return query.select === undefined || plan?.verify !== true
      ? opened
      : opened.map((row) => projectRow(row, query.select ?? []));
  };

  /** A query for the adapter: the rewritten condition, and no field mask when the original is to be re-checked. */
  const rawQuery = (query: RowQuery, plan: PlannedCondition | undefined): RowQuery => {
    const { where: _where, select, ...rest } = query;
    return {
      ...rest,
      ...(plan === undefined ? {} : { where: plan.condition }),
      ...(select === undefined || plan?.verify === true ? {} : { select }),
    };
  };

  const find = async (entity: EntityDescriptor, query: RowQuery): Promise<RowPage> => {
    checkSortable(entity, query.sort);
    const plan = await planOf(entity, query.where);
    if (plan?.scan === true) return scanFind(context, entity, query, plan);
    const forward = query.page === undefined || !('position' in query.page);
    const want = query.page !== undefined && 'first' in query.page ? query.page.first : undefined;
    const paged =
      forward &&
      (query.page === undefined ||
        (!('before' in query.page && query.page.before !== undefined) &&
          !('last' in query.page && query.page.last !== undefined)));
    if (plan?.approximate === true && paged && want !== undefined && want > 0) {
      const filled = await fillApproximatePage(
        want,
        query,
        (page) => raw.find(entity, rawQuery({ ...query, page }, plan)),
        (rows) => settle(entity, query, rows, plan),
      );
      if (query.total !== true) return filled;
      return {
        ...filled,
        total: (
          await candidates(
            entity,
            query.where,
            plan,
            query.includeArchived === true ? { includeArchived: true } : {},
          )
        ).length,
      };
    }
    const page = await raw.find(entity, rawQuery(query, plan));
    return { ...page, rows: await settle(entity, query, page.rows, plan) };
  };

  const candidates = async (
    entity: EntityDescriptor,
    where: Condition | undefined,
    plan: PlannedCondition,
    extra: Pick<RowQuery, 'includeArchived'> = {},
  ): Promise<readonly StorageRow[]> =>
    (
      await scanSelected(
        context,
        entity,
        { ...(where === undefined ? {} : { where }), ...extra },
        plan,
      )
    ).rows;

  const store: RowStore = {
    find,
    findOne: async (entity, query) =>
      (await find(entity, { ...query, page: { first: 1 } })).rows[0],
    count: async (entity, where) => {
      const plan = await planOf(entity, where);
      if (plan !== undefined && (plan.scan || plan.approximate)) {
        return (await candidates(entity, where, plan)).length;
      }
      return raw.count(entity, plan?.condition);
    },
    exists: (entity, ids) => raw.exists(entity, ids),
    matching: async (entity, ids, where) => {
      const plan = await planOf(entity, where);
      if (plan === undefined || !(plan.scan || plan.approximate)) {
        return raw.matching(entity, ids, plan?.condition ?? where);
      }
      const wanted = new Set(ids);
      const rows = await candidates(entity, where, plan, { includeArchived: true });
      return new Set(rows.map((row) => String(row.id)).filter((id) => wanted.has(id)));
    },
    insert: async (entity, rows) => {
      const sealed: StorageRow[] = [];
      for (const row of rows) sealed.push(await sealRow(context, entity, row));
      await raw.insert(entity, sealed);
    },
    update: async (entity, updates) => {
      const sealed = [];
      for (const update of updates) {
        sealed.push({ ...update, values: await sealRow(context, entity, update.values) });
      }
      await raw.update(entity, sealed);
    },
    purge: (entity, ids) => raw.purge(entity, ids),
  };
  const { lock, search, countBefore } = raw;
  return {
    ...store,
    ...(lock === undefined
      ? {}
      : {
          lock: async (entity, query, options) => {
            checkSortable(entity, query.sort);
            const plan = await planOf(entity, query.where);
            if (plan?.scan === true) {
              throw errors.unsupported('A prefix scan does not lock rows.');
            }
            const rows = await lock.call(raw, entity, rawQuery(query, plan), options);
            return settle(entity, query, rows, plan);
          },
        }),
    ...(search === undefined
      ? {}
      : {
          search: async (entity, request) => {
            const plan = await planOf(entity, request.where);
            if (plan !== undefined && (plan.scan || plan.approximate)) {
              throw errors.unsupported('A search does not combine with a prefix scan.');
            }
            const page = await search.call(raw, entity, {
              ...request,
              ...(plan === undefined ? {} : { where: plan.condition }),
            });
            return { ...page, rows: await openAll(entity, page.rows) };
          },
        }),
    ...(countBefore === undefined
      ? {}
      : {
          countBefore: async (entity, query, id) => {
            const plan = await planOf(entity, query.where);
            if (plan !== undefined && (plan.scan || plan.approximate)) {
              throw errors.unsupported('Positions do not combine with a prefix scan.');
            }
            return countBefore.call(raw, entity, rawQuery(query, plan), id);
          },
        }),
  };
}
