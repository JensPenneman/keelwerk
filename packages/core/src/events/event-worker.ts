import type { RuntimeService } from '../runtime/runtime-service.ts';

/**
 * The deployment-level point `eventWorkers` (mode set, S-154): `consumers()`, `retention()` and
 * `erasure()` of @keelwerk/events, listed in `infrastructure` and sorted into
 * `RuntimeInfrastructure.eventWorkers`. An infrastructure entry: `kind` tags it and it provides no
 * contract.
 */
export interface EventWorker extends RuntimeService {
  readonly kind: 'eventWorker';
  readonly provides: readonly [];
  /** 'asyncReactions' lifts asyncReactionsUnavailable at boot. */
  readonly runs: readonly ('asyncReactions' | 'retention' | 'erasure')[];
}
