import type { TenantResolver } from '../edge/tenant-resolver.ts';

/** Resolves the tenant from the host name, over the rows of `core.domain` (section 12). */
export function byHostname(): TenantResolver {
  return { kind: 'hostname' };
}
