import { errors } from '@keelwerk/core';
import type { LiveHubOptions } from './live-hub-options.ts';

function limit(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw errors.validation(`The live hub option ${name} must be an integer of at least 1.`);
  }
  return value;
}

/** The options of a hub with every default filled in. */
export interface ResolvedHubLimits {
  readonly pollMs: number;
  readonly passTimeoutMs: number;
  readonly batchSize: number;
  readonly maxBufferedItems: number;
  readonly maxBufferedBytes: number;
  readonly visibilityBound: number;
  readonly maxHeldBatches: number;
  readonly maxSubscribersPerScope: number;
  readonly maxSubscribers: number;
  readonly maxPlanGroupsPerScope: number;
  readonly maxEarlierStreams: number;
  readonly maxStartUnitsPerScope: number;
  readonly maxStartUnits: number;
}

/** The options with their defaults; a number that is not an integer of at least 1 is `validation`. */
export function resolveHubLimits(options: LiveHubOptions): ResolvedHubLimits {
  return {
    pollMs: limit('pollMs', options.pollMs, 1000),
    passTimeoutMs: limit('passTimeoutMs', options.passTimeoutMs, 10_000),
    batchSize: limit('batchSize', options.batchSize, 500),
    maxBufferedItems: limit('maxBufferedItems', options.maxBufferedItems, 1000),
    maxBufferedBytes: limit('maxBufferedBytes', options.maxBufferedBytes, 1_048_576),
    visibilityBound: limit('visibilityBound', options.visibilityBound, 10_000),
    maxHeldBatches: limit('maxHeldBatches', options.maxHeldBatches, 16),
    maxSubscribersPerScope: limit('maxSubscribersPerScope', options.maxSubscribersPerScope, 1000),
    maxSubscribers: limit('maxSubscribers', options.maxSubscribers, 10_000),
    maxPlanGroupsPerScope: limit('maxPlanGroupsPerScope', options.maxPlanGroupsPerScope, 200),
    maxEarlierStreams: limit('maxEarlierStreams', options.maxEarlierStreams, 1000),
    maxStartUnitsPerScope: limit('maxStartUnitsPerScope', options.maxStartUnitsPerScope, 4),
    maxStartUnits: limit('maxStartUnits', options.maxStartUnits, 32),
  };
}
