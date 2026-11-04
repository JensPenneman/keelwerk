import type { IdOf } from '../model/id-of.ts';
import type { Page } from '../model/page.ts';
import type { Where } from '../model/where.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import type { HistoryEntry } from './history-entry.ts';
import type { QuerySpec } from './query-spec.ts';
import type { Sort } from './sort.ts';

/** The load requests of one entity (section 7.9.3); `forCaller()` narrows them to the caller's view. */
export interface EntityLoads<R, Rc> {
  byId(id: IdOf<R>): LoadRequest<R | undefined>;
  one(query: { readonly where: Where<R> }): LoadRequest<R | undefined>;
  many(query: {
    readonly where?: Where<R>;
    readonly sort?: readonly Sort<R>[];
    readonly limit?: number;
  }): LoadRequest<readonly R[]>;
  count(where?: Where<R>): LoadRequest<number>;
  exists(where: Where<R>): LoadRequest<boolean>;
  query(query: QuerySpec<R>): LoadRequest<Page<R>>;
  history(
    id: IdOf<R>,
    options?: { readonly asOf?: Temporal.Instant },
  ): LoadRequest<readonly HistoryEntry<R>[]>;
  forCaller(): EntityLoads<Rc, Rc>;
}
