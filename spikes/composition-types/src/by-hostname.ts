import type { TenantResolver } from './tenant-resolver.ts';

/** Resolves the tenant from the host name. */
export function byHostname(): TenantResolver {
  return { kind: 'tenantResolver', by: 'hostname' };
}
