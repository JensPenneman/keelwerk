import type { BackendRecord } from '../invoker/backend-record.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import type { TenantRecord } from '../invoker/tenant-record.ts';
import type { Logger } from '../observability/logger.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { ControlStore } from './control-store.ts';
import { findControlRows } from './find-control-rows.ts';
import type { NamespaceBook } from './namespace-book.ts';

function statusOf(row: StorageRow): 'active' | 'suspended' {
  return row.status === 'suspended' ? 'suspended' : 'active';
}

/** The directory the invoker resolves scopes with: reads over the control store, kept in a cache that the control namespace's change feed invalidates. */
export interface ScopeDirectoryCache {
  readonly lookup: ScopeLookup;
  /** Drops every cached row; the next lookup reads the control store again. */
  invalidate(): void;
  /** Follows the control namespace's change feed until `signal` aborts; each wake-up invalidates the cache. */
  follow(signal: AbortSignal): Promise<void>;
}

/**
 * The scope directory over the control store (S-20): `byHostname` reads `core.domain`, the backend
 * and tenant lookups read `core.backend` and `core.tenant`. Only rows found are cached, so a
 * backend or tenant created a moment ago resolves at once; a changed or archived row is dropped
 * when the control namespace's feed wakes (a suspended tenant is therefore refused within one
 * poll or notification of the change).
 */
export function createScopeDirectoryCache(options: {
  readonly store: ControlStore;
  readonly book: NamespaceBook;
  readonly log: Logger;
}): ScopeDirectoryCache {
  const { store, book } = options;
  const domains = new Map<string, { backendId: string; tenantId: string | null }>();
  const backends = new Map<string, BackendRecord>();
  const tenants = new Map<string, TenantRecord>();
  const backendRows = new Map<string, StorageRow>();

  const backendRow = async (id: string): Promise<StorageRow | undefined> => {
    const known = backendRows.get(id);
    if (known !== undefined) return known;
    const [row] = await findControlRows(store, 'core.backend', { id });
    if (row !== undefined) backendRows.set(id, row);
    return row;
  };

  const lookup: ScopeLookup = {
    hostname: async (host) => {
      const known = domains.get(host);
      if (known !== undefined) return known;
      const [row] = await findControlRows(store, 'core.domain', { hostname: host });
      if (row === undefined) return undefined;
      const found = {
        backendId: String(row.backendId),
        tenantId: row.tenantId === null || row.tenantId === undefined ? null : String(row.tenantId),
      };
      domains.set(host, found);
      return found;
    },
    backend: async (id) => {
      const known = backends.get(id);
      if (known !== undefined) return known;
      const row = await backendRow(id);
      if (row === undefined) return undefined;
      const placement = String(row.placement);
      const record: BackendRecord = {
        id,
        app: String(row.app),
        placementId: placement,
        namespace: await book.namespaceOf(placement, String(row.app)),
        status: statusOf(row),
        ...(typeof row.apiVersion === 'string' ? { apiVersion: row.apiVersion } : {}),
      };
      backends.set(id, record);
      return record;
    },
    tenant: async (id) => {
      const known = tenants.get(id);
      if (known !== undefined) return known;
      const [row] = await findControlRows(store, 'core.tenant', { id });
      if (row === undefined) return undefined;
      const backend = await backendRow(String(row.backendId));
      if (backend === undefined) return undefined;
      const placement =
        typeof row.placement === 'string' ? row.placement : String(backend.placement);
      const record: TenantRecord = {
        id,
        backendId: String(row.backendId),
        placementId: placement,
        namespace: await book.namespaceOf(placement, String(backend.app)),
        status: statusOf(row),
        ...(typeof row.apiVersion === 'string' ? { apiVersion: row.apiVersion } : {}),
      };
      tenants.set(id, record);
      return record;
    },
  };

  const invalidate = (): void => {
    domains.clear();
    backends.clear();
    tenants.clear();
    backendRows.clear();
  };

  return {
    lookup,
    invalidate,
    follow: async (signal) => {
      try {
        for await (const _wake of store.adapter.feed.wake([store.namespace], signal)) {
          invalidate();
        }
      } catch (error) {
        if (!signal.aborted) {
          options.log.error('the control namespace feed failed; the scope directory reads on', {
            cause: error,
          });
        }
      }
    },
  };
}
