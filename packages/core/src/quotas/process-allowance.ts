import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { QuotaLimit } from './quota-limit.ts';

/** One rate bucket of a request: the keyed hash of its name and its resolved limit. */
export interface RateBucket {
  readonly key: string;
  readonly limit: Extract<QuotaLimit, { kind: 'rate' }>;
}

/** The tokens one process holds of the shared rate buckets of its scopes (S-143, decision 156). */
export interface ProcessAllowance {
  /**
   * Takes one token of each bucket in the order given, from the held allowance, else from the
   * shared bucket in one unit of the scope. The first bucket that refuses stops the rest: the
   * answer is its wait in seconds, and the buckets after it give nothing. Undefined when every
   * bucket gave its token. `dry`: reads the levels, takes nothing.
   */
  take(
    target: ScopeTarget,
    buckets: readonly RateBucket[],
    dry: boolean,
  ): Promise<number | undefined>;
}
