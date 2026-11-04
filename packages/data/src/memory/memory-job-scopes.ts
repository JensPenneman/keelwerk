import type { MemoryJobTables } from './memory-job-tables.ts';
import { memoryJobTables } from './memory-job-tables.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

/**
 * The queue tables a unit reaches: its own scope's, or, in a namespace-scope unit (the take and
 * the statistics, whose policies admit it), every scope's that has any.
 */
export function memoryJobScopes(ctx: MemoryUnitContext): readonly MemoryJobTables[] {
  if (ctx.scope.level !== 'namespace') return [memoryJobTables(ctx, ctx.scopeId())];
  const ids = new Set<string>();
  for (const name of ctx.tx.names('lanes/')) ids.add(name.slice('lanes/'.length));
  return [...ids].sort().map((id) => memoryJobTables(ctx, id));
}
