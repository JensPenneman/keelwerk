import { alwaysCondition } from '../authorization/always-condition.ts';
import type { RelationAnswerer } from '../authorization/relation-answerer.ts';
import type { Condition } from '../conditions/condition.ts';
import type { ConditionInput } from '../conditions/condition-input.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import type { QueryDescription } from '../protocol/query-description.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import { createEntityRepository } from '../repositories/entity-repository.ts';
import type { Position } from '../storage/position.ts';
import type { RowPage } from '../storage/row-page.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { AnswerDeps } from './answer-deps.ts';
import { assertLoadVisible } from './assert-load-visible.ts';
import { authorityOf } from './authority-of.ts';
import { planQueryDescription } from './plan-query-description.ts';
import { recordLoadPosition } from './record-load-position.ts';
import { refuseRequest } from './refuse-request.ts';
import { requestName } from './request-name.ts';

/** The most rows `many` returns (section 7.9.3). */
const manyLimit = 1000;

type Sorting = NonNullable<RowQuery['sort']>;

function invalid(path: string, message: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'validation',
    code: 'core.validation',
    message,
    issues: [{ path: [path], message }],
  });
}

function whereOf(value: unknown): Condition | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw invalid('where', 'A where must be an object.');
  }
  return normalizeCondition(value as ConditionInput);
}

/**
 * The scope an entity's rows live in when it is not the unit's: a tenant invocation reads
 * backend entities in a read-only snapshot of the backend (14.3.6). Everything else that is not
 * the unit's own scope is refused.
 */
function targetScope(
  request: LoadRequest,
  entry: EntityEntry,
  context: AnswerContext,
): StorageScope | undefined {
  const tenancy = entry.descriptor.tenancy;
  const { scope } = context.unit;
  if (tenancy === 'invocation' || tenancy === scope.level) return undefined;
  if (tenancy === 'backend' && scope.level === 'tenant') {
    return { level: 'backend', backendId: scope.backendId };
  }
  throw refuseRequest(
    requestName(request),
    `"${entry.ref}" is ${tenancy} data and a ${scope.level} unit does not reach it`,
  );
}

/**
 * Answers `ctx.load` (section 7.9.3): the unit, with the requesting module's authority or, for
 * `forCaller()`, narrowed by the caller's read plan and masked. Every read is positioned and its
 * position recorded in the order the loads were answered (S-19).
 */
export async function answerLoad(
  request: LoadRequest,
  context: AnswerContext,
  deps: AnswerDeps,
): Promise<unknown> {
  const name = requestName(request);
  const entry = assertLoadVisible(request, context, deps.authorities);
  const authority = authorityOf(deps.authorities, request, context.module);
  const view = request.view === 'caller' ? deps.views(entry, context) : undefined;

  const read = async (unit: Unit, crossed: boolean): Promise<unknown> => {
    const repository = createEntityRepository(unit, entry);
    const answerer: RelationAnswerer = async (ref, node, ids) => {
      const related = context.registry.entities.get(ref);
      if (related === undefined) throw refuseRequest(name, `"${ref}" is not an entity of this app`);
      return unit.rows.matching(related.descriptor, ids, node);
    };
    const select = (where: Condition | undefined, sort: Sorting = []): Condition =>
      view === undefined
        ? (where ?? alwaysCondition)
        : view.select(
            where,
            sort.map((item) => item.field),
          );
    const finish = async (rows: readonly StorageRow[]): Promise<readonly StorageRow[]> =>
      (view === undefined ? rows : await view.mask(rows, answerer)).map((row) =>
        decodeRow(entry, row, authority),
      );
    const load = async (query: RowQuery) => {
      const found = await repository.find({
        ...query,
        ...(request.forUpdate ? { forUpdate: true } : {}),
      });
      recordLoadPosition(context, found.position, crossed);
      return found;
    };

    const [first] = request.args;
    switch (request.op) {
      case 'byId': {
        if (typeof first !== 'string') throw invalid('id', 'An id must be a string.');
        const found = await load({
          where: select({ op: 'eq', field: 'id', value: first }),
          page: { first: 1 },
        });
        return (await finish(found.rows))[0];
      }
      case 'one': {
        const { where } = (first ?? {}) as { readonly where?: unknown };
        const condition = whereOf(where);
        if (condition === undefined) throw invalid('where', 'one needs a where.');
        const found = await load({ where: select(condition), page: { first: 1 } });
        return (await finish(found.rows))[0];
      }
      case 'many': {
        const spec = (first ?? {}) as {
          readonly where?: unknown;
          readonly sort?: Sorting;
          readonly limit?: number;
        };
        const limit = spec.limit ?? manyLimit;
        if (!Number.isInteger(limit) || limit < 1 || limit > manyLimit) {
          throw invalid('limit', `The limit must be an integer from 1 to ${manyLimit}.`);
        }
        const found = await load({
          where: select(whereOf(spec.where), spec.sort),
          ...(spec.sort === undefined ? {} : { sort: spec.sort }),
          page: { first: limit },
        });
        return finish(found.rows);
      }
      case 'count': {
        const found = await load({
          where: select(whereOf(first)),
          page: { first: 1 },
          total: true,
        });
        if (found.page.total === undefined) {
          throw new KeelwerkError({
            kind: 'internal',
            code: 'core.internal',
            message: `The adapter returned no total for a counting read of "${entry.ref}".`,
          });
        }
        return found.page.total;
      }
      case 'exists': {
        const found = await load({ where: select(whereOf(first)), page: { first: 1 } });
        return found.rows.length > 0;
      }
      case 'query': {
        const { where, ...rest } = (first ?? {}) as Omit<QueryDescription, 'entity'>;
        const planned = planQueryDescription(
          { entity: entry.ref, ...rest },
          entry,
          select(whereOf(where), rest.sort ?? entry.page.defaultSort),
        );
        let items: readonly StorageRow[];
        let page: RowPage;
        let position: Position;
        if (planned.search !== undefined) {
          if (unit.rows.search === undefined) {
            throw refuseRequest(name, 'the adapter has no search');
          }
          page = await unit.rows.search(entry.descriptor, {
            index: planned.search.index,
            match: { text: planned.search.text },
            ...(planned.search.subject === undefined ? {} : { subject: planned.search.subject }),
            ...(planned.query.where === undefined ? {} : { where: planned.query.where }),
            ...(planned.query.page === undefined ? {} : { page: planned.query.page }),
          });
          position = (await unit.events.head()) ?? 0n;
          recordLoadPosition(context, position, crossed);
          items = page.rows;
        } else {
          const found = await load(planned.query);
          page = found.page;
          position = found.position;
          items = found.rows;
        }
        if (
          planned.scan !== undefined &&
          planned.scanBound &&
          page.pageInfo.hasNextPage &&
          !planned.scan.partial
        ) {
          throw new KeelwerkError({
            kind: 'unsupported',
            code: 'core.scan_limit',
            message: `The scan of "${entry.ref}" reached its limit of ${planned.scan.limit} rows.`,
          });
        }
        return {
          items: await finish(items),
          pageInfo: { hasNextPage: page.pageInfo.hasNextPage, endCursor: page.pageInfo.endCursor },
          queryState: deps.queryState(position, unit.scope, {
            entity: entry.ref,
            filter: planned.query.where,
            sort: planned.query.sort ?? [],
          }),
        };
      }
    }
  };

  const target = targetScope(request, entry, context);
  return target === undefined
    ? read(context.unit, false)
    : deps.inScope(context.unit, target, (unit) => read(unit, true));
}
