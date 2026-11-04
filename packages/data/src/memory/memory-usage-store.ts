import type { UsageStore } from '@keelwerk/core';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** The quota counters of the unit's scope (12.2); they commit with the data they count. */
export function memoryUsageStore(ctx: MemoryUnitContext): UsageStore {
  const name = (): string => `usage/${ctx.scopeId()}`;
  return {
    add: async (dimension, delta) => {
      ctx.writable();
      const table = ctx.tx.write<bigint>(name());
      const value = (table.get(dimension) ?? 0n) + delta;
      table.set(dimension, value);
      return value;
    },
    get: async (dimension) => ctx.tx.read<bigint>(name()).get(dimension) ?? 0n,
  };
}
