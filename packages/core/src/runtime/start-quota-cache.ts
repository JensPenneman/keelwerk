import { readBackendQuotas } from '../control/read-backend-quotas.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import { createQuotaCache, type QuotaCache } from '../quotas/create-quota-cache.ts';
import { connectWhileUnavailable } from './connect-while-unavailable.ts';
import type { Connected } from './connected.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';

/**
 * The process's one quota cache, built after `migrate` and loaded once before the restore check
 * enqueues: a lane takes its cap and weight from the limits of the store, also in the first enqueue
 * of a process. A database that is away is waited for as at connect (`connectWhileUnavailable`: the
 * policy of the background loops, ended by `signal`); any other error ends the start.
 */
export async function startQuotaCache(input: {
  readonly deployment: DeploymentDefinition;
  readonly connected: Connected;
  readonly clock: Clock;
  readonly log: Logger;
  readonly signal: AbortSignal | undefined;
}): Promise<QuotaCache> {
  const { deployment, connected, clock, log } = input;
  const cache = createQuotaCache({
    quotas: connected.control.quotas,
    backendQuotas: () => readBackendQuotas(connected.control),
    queues: deployment.queues,
    clock,
    log,
    signal: connected.signal,
  });
  await connectWhileUnavailable('control', () => cache.firstLoad(), { log, signal: input.signal });
  return cache;
}
