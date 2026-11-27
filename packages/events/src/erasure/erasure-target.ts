import type { ErasureRecord, RuntimeServiceContext, ScopeTarget } from '@keelwerk/core';
import { scopeTargetOf } from '../consumers/scope-target-of.ts';

/** Where an erasure's tenant is served in this process: its source and its tenant-scope target, and the target of its backend scope. */
export interface ErasureTarget {
  readonly source: RuntimeServiceContext['namespaces'][number];
  readonly target: ScopeTarget;
  /** The tenant's backend scope, where the request records of the principals that acted there are kept (14.7.5). */
  readonly backend: ScopeTarget & {
    readonly scope: { readonly level: 'backend'; readonly backendId: string };
  };
}

/** What `erasureTarget` answers when this process does not serve what the erasure needs: the tenant itself, or its backend scope. */
export interface ErasureUnserved {
  readonly unserved: 'tenant' | 'backend';
}

/** The source and scope a tenant's data lives in here, with its backend's, archived tenants included, or what another process holds. */
export async function erasureTarget(
  context: RuntimeServiceContext,
  record: Pick<ErasureRecord, 'tenantId'>,
): Promise<ErasureTarget | ErasureUnserved> {
  for (const source of context.namespaces) {
    const target = await scopeTargetOf({
      source,
      scopeId: record.tenantId,
      directory: context.archivedDirectory,
      deploymentId: context.control.deploymentId,
    });
    if (target?.scope.level !== 'tenant') continue;
    for (const holder of context.namespaces) {
      const backend = await scopeTargetOf({
        source: holder,
        scopeId: target.scope.backendId,
        directory: context.archivedDirectory,
        deploymentId: context.control.deploymentId,
      });
      if (backend?.scope.level === 'backend') {
        return { source, target, backend: { ...backend, scope: backend.scope } };
      }
    }
    return { unserved: 'backend' };
  }
  return { unserved: 'tenant' };
}
