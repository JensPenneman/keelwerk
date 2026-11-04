import type { IdOf } from './module-rows.ts';

/** One change of an entity row, as `watch` and `ctx.live.entity` deliver it. */
export type EntityChange<R> =
  | { readonly type: 'created' | 'changed' | 'restored'; readonly id: IdOf<R>; readonly row: R }
  | { readonly type: 'archived' | 'removed'; readonly id: IdOf<R> };
