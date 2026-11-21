import type { StorageScope, UsageCharge } from '@keelwerk/core';

/**
 * The charge of `bytes` of stored records under `core.eventBytes` (12.2), counted and never
 * refused (`limit` null): what an adapter buffers when a unit appends events or stream records.
 * Nothing for no bytes, and nothing in a deployment or a namespace unit: the dimension is counted
 * per tenant and per backend only.
 */
export function storedRecordsCharge(scope: StorageScope, bytes: bigint): readonly UsageCharge[] {
  if (bytes === 0n || (scope.level !== 'tenant' && scope.level !== 'backend')) return [];
  return [{ dimension: 'core.eventBytes', delta: bytes, limit: null }];
}
