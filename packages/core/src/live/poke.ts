import type { StateToken } from '../events/state-token.ts';

/** One item of `live.pokes` (15.2.5): the new token per entity type the principal may read. */
export interface Poke {
  /** The position after the batch. */
  readonly upto: StateToken;
  /** Entity reference to its new state token. */
  readonly changed: Readonly<Record<string, StateToken>>;
  readonly partition?: string;
}
