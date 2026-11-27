import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { RuntimeServiceContext } from '../runtime/runtime-service-context.ts';
import type { QueueSource } from '../worker/queue-source.ts';

/** What the step `reach` runs with: the process's services, the tenant's source and target, the record. */
export interface ReachErasureInput {
  readonly context: Pick<
    RuntimeServiceContext,
    'apps' | 'build' | 'clock' | 'compute' | 'control' | 'keys' | 'log' | 'quotas'
  >;
  readonly source: QueueSource;
  /** The tenant's target; its adapter is the worker's guarded one, so the units it opens stop with the worker. */
  readonly target: ScopeTarget;
  readonly record: ErasureRecord;
  /** Runs inside the writing unit, before its writes: the seam of the step. */
  readonly insideUnit?: () => Promise<void>;
}
