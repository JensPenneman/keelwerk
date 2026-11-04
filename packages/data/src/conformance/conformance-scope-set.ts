import type { Scope } from '@keelwerk/core';

/** The scopes the suites run units in: two tenants of one backend, a tenant of another, and the levels above. */
export interface ConformanceScopeSet {
  readonly tenantA: Extract<Scope, { readonly level: 'tenant' }>;
  readonly tenantB: Extract<Scope, { readonly level: 'tenant' }>;
  readonly tenantC: Extract<Scope, { readonly level: 'tenant' }>;
  readonly backend: Extract<Scope, { readonly level: 'backend' }>;
  readonly otherBackend: Extract<Scope, { readonly level: 'backend' }>;
  readonly deployment: Extract<Scope, { readonly level: 'deployment' }>;
}
