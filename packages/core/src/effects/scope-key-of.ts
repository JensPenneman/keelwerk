import type { Scope } from '../storage/scope.ts';

/** The id a scope is known by in derived ids: the tenant id, the backend id, or `deployment`. */
export function scopeKeyOf(scope: Scope): string {
  if (scope.level === 'tenant') return scope.tenantId;
  if (scope.level === 'backend') return scope.backendId;
  return 'deployment';
}
