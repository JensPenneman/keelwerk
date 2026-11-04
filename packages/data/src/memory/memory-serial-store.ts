import type { SerialStore } from '@keelwerk/core';
import { malformedQuery } from '../sql/malformed-query.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';
import { memoryValueKey } from './memory-value-key.ts';

/**
 * The counters of `field.serial({ per })` (15.1.4): one per entity, field and partition of the
 * unit's scope, starting at 1. Values are never reused: a rolled-back unit restores the counter,
 * and nothing saw the values it had taken.
 */
export function memorySerialStore(ctx: MemoryUnitContext): SerialStore {
  return {
    next: async (entity, field, partition, count = 1) => {
      ctx.writable();
      const scopeId = ctx.reach(entity);
      if (entity.fields[field]?.kind !== 'serial') {
        throw malformedQuery(`${entity.ref}.${field} is not a serial field`);
      }
      if (!Number.isInteger(count) || count < 1)
        throw malformedQuery('count must be a positive integer');
      const key = [
        entity.ref,
        field,
        partition.map((value) => memoryValueKey(value)).join('\u0001'),
      ].join('\u0000');
      const table = ctx.tx.write<bigint>(`serials/${scopeId}`);
      const first = table.get(key) ?? 1n;
      table.set(key, first + BigInt(count));
      return first;
    },
  };
}
