import type { SqlUnitContext } from './sql-unit-context.ts';

/**
 * The scope id the queue statements restrict themselves to: the unit's own, or null in a
 * namespace-scope unit, which reaches every scope. Row-level security is the second line.
 */
export function jobUnitScopeId(ctx: SqlUnitContext): string | null {
  return ctx.scope.level === 'namespace' ? null : ctx.scopeId();
}
