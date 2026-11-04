import type { TenantResolver } from './tenant-resolver.ts';

/** Resolves the tenant from a request header. */
export function byHeader(header: string): TenantResolver {
  return { kind: 'tenantResolver', by: 'header', header };
}
