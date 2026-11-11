import type { JobCarrier } from '../invoker/job-carrier.ts';
import { retryHorizonMs } from '../jobs/retry-horizon-ms.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { isCrossScopeJob } from '../worker/is-cross-scope-job.ts';
import { defaultReceiptWindowMs } from './default-receipt-window-ms.ts';

/**
 * How long the receipt of a command lasts: the action's idempotency window, undefined for the
 * default. The receipt in a unit is the only guard against running the command twice when its job
 * lives in another scope's lane and settles there later (a crash between the two, or a failed
 * settle, retries the job), so for such a job (`isCrossScopeJob`) it lasts at least the default
 * window and at least the job's own retry horizon (`retryHorizonMs`), whatever the action's own
 * window is: a short window must not shorten it, and a job retried for longer than a day must not
 * find its receipt gone.
 */
export function receiptWindowMs(
  action: Pick<ActionEntry, 'scope' | 'idempotencyWindowMs'>,
  job: Pick<JobCarrier, 'scope' | 'retry'> | undefined,
): number | undefined {
  return job !== undefined && isCrossScopeJob(job.scope, action.scope)
    ? Math.max(action.idempotencyWindowMs ?? 0, defaultReceiptWindowMs, retryHorizonMs(job.retry))
    : action.idempotencyWindowMs;
}
