import type { StateToken } from '../events/state-token.ts';

/** What a `live.pokes` subscription follows: the session's scope, resumed from `after`. */
export interface LivePokesPlan {
  readonly kind: 'pokes';
  readonly after: StateToken | undefined;
  /** Applied to each item in array order; an answer of `undefined` drops the item. */
  readonly maps: readonly ((item: unknown) => unknown)[];
}
