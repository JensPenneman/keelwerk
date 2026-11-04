import type { TenantResolver } from '../edge/tenant-resolver.ts';

/** Resolves the tenant from a scope key; refused at boot until the scope directory exists (S-20, gap G2). */
export function byScopeKey(): TenantResolver {
  return { kind: 'scopeKey' };
}
