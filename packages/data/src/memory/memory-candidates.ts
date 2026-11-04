import type { Condition, EntityDescriptor, StorageRow } from '@keelwerk/core';
import { memoryCheckCondition } from './memory-check-condition.ts';
import { memoryEvaluate } from './memory-evaluate.ts';
import { memorySource } from './memory-source.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * The entity's rows in the unit's scope that satisfy `where`, unordered. Archived rows are left out
 * unless asked for (the default of 14.3.2).
 */
export function memoryCandidates(
  ctx: MemoryUnitContext,
  entity: EntityDescriptor,
  where: Condition | undefined,
  includeArchived: boolean,
): StorageRow[] {
  if (where !== undefined) memoryCheckCondition(entity, where, ctx.entity, ctx.reach);
  const source = memorySource(ctx);
  const found: StorageRow[] = [];
  for (const row of ctx.rows(entity).values()) {
    if (!includeArchived && row.archivedAt !== undefined && row.archivedAt !== null) continue;
    if (where !== undefined && !memoryEvaluate(source, entity, where, row)) continue;
    found.push(row);
  }
  return found;
}
