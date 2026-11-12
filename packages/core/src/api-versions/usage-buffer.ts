import type { ApiUsageCount } from '../storage/api-usage-store.ts';

type Key = Omit<ApiUsageCount, 'count'>;

function keyOf(key: Key): string {
  return [key.day, key.backendId, key.tenantId, key.apiVersion, key.transport, key.item].join('\0');
}

/** The counts of one process between two flushes. */
export interface UsageBuffer {
  /** Adds 1 under the key. */
  add(key: Omit<ApiUsageCount, 'count'>): void;
  /** The counts in key order; the buffer is empty afterwards. */
  drain(): readonly ApiUsageCount[];
  /** Merges counts back (a flush that failed). */
  restore(counts: readonly ApiUsageCount[]): void;
  readonly size: number;
}

/** An empty buffer. */
export function createUsageBuffer(): UsageBuffer {
  const counts = new Map<string, ApiUsageCount>();
  function addCount(key: Key, by: number): void {
    const id = keyOf(key);
    const held = counts.get(id);
    counts.set(id, {
      day: key.day,
      backendId: key.backendId,
      tenantId: key.tenantId,
      apiVersion: key.apiVersion,
      transport: key.transport,
      item: key.item,
      count: (held?.count ?? 0) + by,
    });
  }
  return {
    add: (key) => addCount(key, 1),
    drain() {
      const rows = [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, row]) => row);
      counts.clear();
      return rows;
    },
    restore(rows) {
      for (const row of rows) addCount(row, row.count);
    },
    get size() {
      return counts.size;
    },
  };
}
