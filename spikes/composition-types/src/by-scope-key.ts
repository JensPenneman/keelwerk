import type { TenantResolver } from './tenant-resolver.ts';

/** Resolves the tenant from a scope key (gap G2). */
export function byScopeKey(): TenantResolver {
  return { kind: 'tenantResolver', by: 'scopeKey' };
}
