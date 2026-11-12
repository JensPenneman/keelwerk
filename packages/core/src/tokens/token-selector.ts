import type { Condition } from '../conditions/condition.ts';

/**
 * What a live stream token adds to its selector: the API version the stream was opened at, its ids
 * and fields (absent is not the same as empty: an empty `ids` matches nothing) and whether it
 * follows archived rows.
 */
export interface LiveSelector {
  readonly apiVersion: string;
  readonly ids?: readonly string[];
  readonly fields?: readonly string[];
  readonly includeArchived?: boolean;
  /** A kernel source's own condition, in event form: absent for every other stream. */
  readonly where?: unknown;
}

/** What a token is for beyond the entity: a partition, for a `queryState` the filter and sort, for a live stream its version and selection. */
export interface TokenSelector {
  readonly partition?: string;
  readonly live?: LiveSelector;
  readonly query?: {
    readonly filter: Condition | undefined;
    readonly sort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
  };
}
