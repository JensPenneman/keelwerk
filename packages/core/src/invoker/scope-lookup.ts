import type { BackendRecord } from './backend-record.ts';
import type { TenantRecord } from './tenant-record.ts';

/**
 * What `resolveScope` reads of the control store: host names over `core.domain`, and the backend
 * and tenant rows. The control store's lookup (WP-43) and `staticScopeDirectory` implement it.
 */
export interface ScopeLookup {
  /** The scope a host name belongs to; `tenantId` is null for a backend-level domain. */
  hostname(
    host: string,
  ): Promise<{ readonly backendId: string; readonly tenantId: string | null } | undefined>;
  backend(id: string): Promise<BackendRecord | undefined>;
  tenant(id: string): Promise<TenantRecord | undefined>;
}
