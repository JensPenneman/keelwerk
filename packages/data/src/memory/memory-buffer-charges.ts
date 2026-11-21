import type { UsageCharge } from '@keelwerk/core';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** Buffers usage charges for the commit tail, in order, in a collection that never installs. */
export function memoryBufferCharges(ctx: MemoryUnitContext, charges: readonly UsageCharge[]): void {
  if (charges.length === 0) return;
  const buffered = ctx.tx.write<UsageCharge>(`~charges/${ctx.scopeId()}`);
  for (const charge of charges) {
    buffered.set(String(buffered.size).padStart(10, '0'), charge);
  }
}
