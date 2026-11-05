import type { Condition } from '../conditions/condition.ts';

/** What a `queryState` is issued for: the entity read, and the filter and sort of the read. */
export interface QueryStateSource {
  readonly entity: string;
  readonly filter: Condition | undefined;
  readonly sort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
}
