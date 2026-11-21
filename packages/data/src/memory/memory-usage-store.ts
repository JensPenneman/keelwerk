import type { UsageStore } from '@keelwerk/core';
import { usageGiveBackCharges } from '../sql/usage-give-back-charges.ts';
import { usageStoreCharges } from '../sql/usage-store-charges.ts';
import { memoryBufferCharges } from './memory-buffer-charges.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** The quota counters of the unit's scope (12.2); they commit with the data they count. */
export function memoryUsageStore(ctx: MemoryUnitContext): UsageStore {
  const name = (): string => `usage/${ctx.scopeId()}`;
  return {
    charge: (charges) => {
      const checked = usageStoreCharges(ctx.scope, charges);
      ctx.writable();
      memoryBufferCharges(ctx, checked);
    },
    giveBack: (dimension, amount) => {
      const charges = usageGiveBackCharges(ctx.scope, dimension, amount);
      ctx.writable();
      memoryBufferCharges(ctx, charges);
    },
    get: async (dimension) => ctx.tx.read<bigint>(name()).get(dimension) ?? 0n,
  };
}
