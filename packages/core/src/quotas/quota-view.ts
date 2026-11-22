import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { QueueLimits } from './queue-limits.ts';
import type { QuotaLimit } from './quota-limit.ts';

/**
 * The limits of the quota cache's rows as they are now: what code in a command, a job or a unit
 * reads. `QuotaLimits.fresh` hands one out, so a path that reads limits has asked the cache for
 * fresh rows first; the kernel queue's view of the cache is the exception (see `QuotaLimits`).
 */
export interface QuotaView {
  /** Synchronous, from memory; `internal` for a ref the registry does not declare. */
  limitOf(registry: Pick<Registry, 'quotas'>, scope: Scope, ref: string): QuotaLimit;
  /** `queues.<q>` of the deployment (running ?? 4, queued ?? 10,000, weight 1) under the same rows and clamp. */
  queueOf(scope: Scope, queue: string): QueueLimits;
}
