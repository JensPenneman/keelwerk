import type { AdapterCapabilities } from '@keelwerk/core';
import type { MaskableCapability } from './maskable-capability.ts';

/**
 * `capabilities` as an adapter that lacks the named accelerations declares itself: `rowLocks` and
 * `search` false, `changeFeed` poll, `positionPaging` false, `broadcast` false, `jobs`
 * single-writer. The kernel then takes its fallback paths (14.3.3); the adapter keeps no other
 * behaviour change, so a masked adapter proves the paths on a database that could do better.
 */
export function maskCapabilities(
  capabilities: AdapterCapabilities,
  masked: readonly MaskableCapability[],
): AdapterCapabilities {
  const off = new Set(masked);
  return {
    ...capabilities,
    ...(off.has('rowLocks') ? { rowLocks: false as const } : {}),
    ...(off.has('changeFeed') ? { changeFeed: 'poll' as const } : {}),
    ...(off.has('search') ? { search: false as const } : {}),
    ...(off.has('positionPaging') ? { positionPaging: false as const } : {}),
    ...(off.has('broadcast') ? { broadcast: false } : {}),
    ...(off.has('jobs') ? { jobs: 'single-writer' as const } : {}),
  };
}
