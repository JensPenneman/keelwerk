import type { MemoryRelationSource } from './memory-evaluate.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/** The relation source of a unit: related rows come from the unit's own scope, and only reachable entities. */
export function memorySource(ctx: MemoryUnitContext): MemoryRelationSource {
  return {
    entityOf: (ref) => ctx.entity(ref),
    rowsOf: (entity) => ctx.rows(entity).values(),
  };
}
