import type { LiveSources } from './live-sources.ts';

/**
 * What a hub is tuned by; every number is an integer of at least 1. Defaults: `pollMs` 1000
 * (15.2.5), `passTimeoutMs` 10,000, `batchSize` 500 events per read (at most four reads a pass),
 * `maxBufferedItems` 1,000 and `maxBufferedBytes` 1 MiB per subscriber (15.4.5), `visibilityBound`
 * 10,000 ids per subscriber (15.4.3), `maxHeldBatches` 16 while a subscriber starts,
 * `maxSubscribersPerScope` 1,000 (15.4.10; a scope is counted per tenant) and `maxSubscribers`
 * 10,000 per hub, `maxPlanGroupsPerScope` 200 distinct read plans in one scope, `maxEarlierStreams`
 * 1,000 streams whose earlier state one pass rebuilds, and `maxStartUnitsPerScope` 4 and
 * `maxStartUnits` 32 read-only units that the starts of subscriptions hold at once.
 */
export interface LiveHubOptions {
  readonly pollMs?: number;
  readonly passTimeoutMs?: number;
  readonly batchSize?: number;
  readonly maxBufferedItems?: number;
  readonly maxBufferedBytes?: number;
  readonly visibilityBound?: number;
  readonly maxHeldBatches?: number;
  readonly maxSubscribersPerScope?: number;
  readonly maxSubscribers?: number;
  readonly maxPlanGroupsPerScope?: number;
  readonly maxEarlierStreams?: number;
  readonly maxStartUnitsPerScope?: number;
  readonly maxStartUnits?: number;
  /** The sources the live module adds to the hub beyond the changes of an entity. */
  readonly sources?: LiveSources;
}
