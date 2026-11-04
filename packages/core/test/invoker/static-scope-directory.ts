import type { BackendRecord } from '../../src/invoker/backend-record.ts';
import type { ScopeLookup } from '../../src/invoker/scope-lookup.ts';
import type { TenantRecord } from '../../src/invoker/tenant-record.ts';

/** Fixed rows for tests, until the control store serves the lookup (WP-43). */
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
