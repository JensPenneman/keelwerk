import type { InfrastructureEntry } from '@keelwerk/core';
import type { TransportBounds } from './transport-bounds.ts';

const defaultStreamsPerPrincipal = 20;
const defaultSubscriptionsPerSocket = 100;

/** A positive whole number at `path` below `root`, read structurally; undefined when it is not one. */
function boundAt(root: unknown, path: readonly string[]): number | undefined {
  let value = root;
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = Reflect.get(value, key);
  }
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The bounds of the host entry the runner started, read from its options without importing the
 * transport: `live.maxStreamsPerPrincipal` and `liveSocket.maxSubscriptionsPerSocket`; an entry that
 * sets neither runs at the host's defaults, 20 and 100.
 */
export function transportBoundsOf(host: InfrastructureEntry): TransportBounds {
  return {
    maxStreamsPerPrincipal:
      boundAt(host, ['options', 'live', 'maxStreamsPerPrincipal']) ?? defaultStreamsPerPrincipal,
    maxSubscriptionsPerSocket:
      boundAt(host, ['options', 'liveSocket', 'maxSubscriptionsPerSocket']) ??
      defaultSubscriptionsPerSocket,
  };
}
