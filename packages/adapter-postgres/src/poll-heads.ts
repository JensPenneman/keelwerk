import type { DataAdapter } from '@keelwerk/core';
import type { PollChangeFeedOptions } from '@keelwerk/data';

/**
 * The heads query of the polling feed (14.3.7): `movedScopes` in a read-only namespace-scope unit,
 * which the maintenance policy lets see every scope of the namespace.
 */
export function pollHeads(adapter: Pick<DataAdapter, 'unit'>): PollChangeFeedOptions['moved'] {
  return async (namespace, since, limit) =>
    adapter.unit(
      namespace,
      { level: 'namespace', reason: 'change feed: poll the heads' },
      async (unit) => unit.events.movedScopes(since, limit),
      { readOnly: true },
    );
}
