import type { QueryDescription } from '../protocol/query-description.ts';
import type { RowQuery } from '../storage/row-query.ts';

/** A query description turned into what the row store takes, plus the parts the answerer handles itself. */
export interface PlannedQuery {
  readonly query: RowQuery;
  /** Truncation of a bounded scan is an error unless `partial` accepts it. */
  readonly scan?: NonNullable<QueryDescription['scan']>;
  readonly search?: NonNullable<QueryDescription['search']>;
  /** True when the page size was cut by the scan bound, so a next page means a truncated scan. */
  readonly scanBound: boolean;
}
