import type { Where } from '../model/where.ts';
import type { Sort } from './sort.ts';

/** What `query` takes, typed by the row (section 7.9.2); the kernel turns it into a `QueryDescription`. */
export interface QuerySpec<R> {
  readonly where?: Where<R>;
  readonly sort?: readonly Sort<R>[];
  readonly page?: { readonly first?: number; readonly after?: string };
  readonly scan?: { readonly limit: number; readonly partial?: boolean };
  readonly search?: { readonly index: string; readonly text: string };
}
