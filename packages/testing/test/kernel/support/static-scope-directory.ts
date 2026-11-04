import type { BackendRecord, ScopeLookup, TenantRecord } from '@keelwerk/core';

/** Fixed rows for tests that build an invoker by hand; a runtime resolves scopes from the control store. */
export interface StaticScopeRows {
  readonly backends: readonly BackendRecord[];
  readonly tenants?: readonly TenantRecord[];
  /** Host names; a null `tenantId` names the backend. */
  readonly domains?: readonly {
    readonly hostname: string;
    readonly backendId: string;
    readonly tenantId: string | null;
  }[];
}

/** A `ScopeLookup` over fixed rows. Host names compare in lower case. */
export function staticScopeDirectory(rows: StaticScopeRows): ScopeLookup {
  return {
    hostname: async (host) => {
      const hit = rows.domains?.find((domain) => domain.hostname.toLowerCase() === host);
      return hit === undefined ? undefined : { backendId: hit.backendId, tenantId: hit.tenantId };
    },
    backend: async (id) => rows.backends.find((backend) => backend.id === id),
    tenant: async (id) => rows.tenants?.find((tenant) => tenant.id === id),
  };
}
