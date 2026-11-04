import { allOf } from '../authorization/all-of.ts';
import type { Condition } from '../conditions/condition.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { QueryDescription } from '../protocol/query-description.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { RowQuery } from '../storage/row-query.ts';
import type { PlannedQuery } from './planned-query.ts';

function invalid(path: string, message: string): KeelwerkError {
  return new KeelwerkError({
    kind: 'validation',
    code: 'core.validation',
    message,
    issues: [{ path: [path], message }],
  });
}

function clamp(size: number, maximum: number, path: string): number {
  if (!Number.isInteger(size) || size < 1)
    throw invalid(path, 'The page size must be a positive integer.');
  return Math.min(size, maximum);
}

/**
 * Plans a query description (section 7.9.2) for the row store: `where` is conjoined with the plan's
 * selection (`selection`, already checked by the caller's view where one applies), the sort must be
 * one the entity's paging allows (section 6.7), the page size defaults to the entity's and is cut
 * at its maximum, and a scan bounds the rows examined.
 */
export function planQueryDescription(
  description: QueryDescription,
  entry: EntityEntry,
  selection: Condition,
): PlannedQuery {
  const where = allOf(
    description.where === undefined
      ? [selection]
      : [normalizeCondition(description.where), selection],
  );
  const sort = description.sort ?? entry.page.defaultSort;
  for (const { field } of sort) {
    if (!entry.page.sortable.includes(field)) {
      throw invalid(field, `"${field}" is not a sortable field of "${entry.ref}".`);
    }
  }
  const { scan } = description;
  if (scan !== undefined && (!Number.isInteger(scan.limit) || scan.limit < 1)) {
    throw invalid('scan.limit', 'A scan limit must be a positive integer.');
  }
  const asked = description.page;
  let page: NonNullable<RowQuery['page']>;
  let scanBound = false;
  if (asked !== undefined && 'position' in asked) {
    page = {
      position: asked.position,
      limit: clamp(asked.limit, entry.page.maxSize, 'page.limit'),
    };
  } else {
    const size = clamp(
      asked?.first ?? asked?.last ?? entry.page.defaultSize,
      entry.page.maxSize,
      'page.first',
    );
    const bounded = scan === undefined ? size : Math.min(size, scan.limit);
    scanBound = bounded < size;
    page = {
      ...(asked?.last === undefined ? { first: bounded } : { last: bounded }),
      ...(asked?.after === undefined ? {} : { after: asked.after }),
      ...(asked?.before === undefined ? {} : { before: asked.before }),
    };
  }
  return {
    query: { where, sort, page },
    ...(scan === undefined ? {} : { scan }),
    ...(description.search === undefined ? {} : { search: description.search }),
    scanBound,
  };
}
