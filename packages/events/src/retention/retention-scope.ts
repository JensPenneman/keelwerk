import type { Registry, ScopeTarget } from '@keelwerk/core';

/** One scope a pass purges: where its data lives, the registry of its app and the ids a run is recorded under. */
export interface RetentionScope {
  readonly target: ScopeTarget;
  readonly registry: Registry;
  /** The deployment id for the deployment scope, else the backend id. */
  readonly backendId: string;
  /** Null above the tenant level. */
  readonly tenantId: string | null;
}
