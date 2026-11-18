import type { ScopeCounters } from './scope-counters.ts';

/** The counters of every scope in a namespace: what the restore check reads and a bump raises (14.7.6). */
export interface CounterStore {
  /** Scopes in scope id order after `after` (only `scopeIds` when given), at most `limit`. */
  list(page: {
    readonly after?: string;
    readonly limit: number;
    readonly scopeIds?: readonly string[];
  }): Promise<readonly ScopeCounters[]>;
  /**
   * next = greatest(next, position + 1); each named serial's next = greatest(next, value + 1);
   * epoch = greatest(epoch, counters.epoch); creates missing rows; never lowers. Needs a writable
   * unit, else it throws an internal error.
   */
  raise(counters: ScopeCounters): Promise<void>;
}
