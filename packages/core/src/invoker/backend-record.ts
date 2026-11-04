import type { NamespaceRef } from '../storage/namespace-ref.ts';

/** What the invoker needs of a `core.backend` row to resolve a scope (section 12.1). */
export interface BackendRecord {
  readonly id: string;
  /** The app the backend runs. */
  readonly app: string;
  /** The placement of the backend's own data. */
  readonly placementId: string;
  /** The namespace of the backend-scope data. */
  readonly namespace: NamespaceRef;
  readonly status: 'active' | 'suspended';
  /** The default API version pin (section 18.3). */
  readonly apiVersion?: string;
}
