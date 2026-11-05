import type { Condition } from '../conditions/condition.ts';

/** What a token is for beyond the entity: a partition, and for a `queryState` the filter and sort. */
export interface TokenSelector {
  readonly partition?: string;
  readonly query?: {
    readonly filter: Condition | undefined;
    readonly sort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
  };
}
