import type { NamespaceRef } from '../storage/namespace-ref.ts';

/** What the invoker needs of a `core.tenant` row to resolve a scope (section 12.1). */
export interface TenantRecord {
  readonly id: string;
  readonly backendId: string;
  /** The placement of the tenant's data. */
  readonly placementId: string;
  /** The namespace of the tenant-scope data. */
  readonly namespace: NamespaceRef;
  readonly status: 'active' | 'suspended';
  readonly apiVersion?: string;
}
