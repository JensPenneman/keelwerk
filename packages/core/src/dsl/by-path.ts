import type { TenantResolver } from '../edge/tenant-resolver.ts';

/**
 * Resolves the tenant from the path prefix `/t/<tenant TypeID>` (S-20, S-146); every other listed
 * resolver that matches must agree with it.
 */
export function byPath(): TenantResolver {
  return { kind: 'path' };
}
