import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { QueueLimits } from './queue-limits.ts';
import type { QuotaLimit } from './quota-limit.ts';

/** What every consumer of the quotas reads: the invoker, the write path and the live limits. */
export interface QuotaLimits {
  /** Synchronous, from memory; `internal` for a ref the registry does not declare. */
  limitOf(registry: Pick<Registry, 'quotas'>, scope: Scope, ref: string): QuotaLimit;
  /** `queues.<q>` of the deployment (running ?? 4, queued ?? 10,000, weight 1) under the same rows and clamp. */
  queueOf(scope: Scope, queue: string): QueueLimits;
  /** Starts following the control feed, never rejects, waits at most `targetingReadTimeoutMs`. */
  fresh(): Promise<void>;
}
