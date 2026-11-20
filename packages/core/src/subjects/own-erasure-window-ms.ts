import { durationMs } from '../effects/duration-ms.ts';
import { retryHorizonMs } from '../jobs/retry-horizon-ms.ts';
import { ownErasureRetry } from './own-erasure-retry.ts';

/**
 * How long the receipt of an `eraseOwnSubject` request lasts: the retry horizon of its job and the
 * longest delay after it, so the receipt cannot run out before the job has started or given up.
 * Nobody asks again for such a request: the requester is the module's own service principal.
 */
export const ownErasureWindowMs: number =
  retryHorizonMs(ownErasureRetry) + durationMs(ownErasureRetry.maxDelay ?? '1h');
