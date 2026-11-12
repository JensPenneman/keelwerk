import type { ApiUsageCount, ApiUsageStore, ApiUsageTotal } from '@keelwerk/core';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function keyOf(row: Omit<ApiUsageCount, 'count'>): string {
  return [row.day, row.backendId, row.tenantId, row.apiVersion, row.transport, row.item].join('\0');
}

function groupOf(row: ApiUsageCount): string {
  return [row.backendId, row.tenantId, row.apiVersion, row.transport, row.item].join('\0');
}

/** `kw_api_usage` of the in-memory adapter (S-144); only deployment-scope units have this store. */
export function memoryApiUsageStore(ctx: MemoryUnitContext): ApiUsageStore {
  const collection = memoryM2Collections.apiUsage;
  return {
    add: async (counts) => {
      ctx.writable();
      const sorted = [...counts].sort((a, b) => compare(keyOf(a), keyOf(b)));
      const table = ctx.tx.write<ApiUsageCount>(collection);
      for (const row of sorted) {
        const key = keyOf(row);
        const held = table.get(key);
        table.set(key, { ...row, count: (held?.count ?? 0) + row.count });
      }
    },
    totals: async (query) => {
      const groups = new Map<string, ApiUsageTotal>();
      for (const row of ctx.tx.read<ApiUsageCount>(collection).values()) {
        if (row.day < query.since || row.day > query.until) continue;
        if (query.backendId !== undefined && row.backendId !== query.backendId) continue;
        if (query.apiVersion !== undefined && row.apiVersion !== query.apiVersion) continue;
        if (query.item !== undefined && row.item !== query.item) continue;
        const key = groupOf(row);
        const held = groups.get(key);
        groups.set(key, {
          backendId: row.backendId,
          tenantId: row.tenantId,
          apiVersion: row.apiVersion,
          transport: row.transport,
          item: row.item,
          count: (held?.count ?? 0) + row.count,
          firstDay: held === undefined || row.day < held.firstDay ? row.day : held.firstDay,
          lastDay: held === undefined || row.day > held.lastDay ? row.day : held.lastDay,
        });
      }
      return [...groups.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([, total]) => total)
        .slice(0, query.limit);
    },
  };
}
