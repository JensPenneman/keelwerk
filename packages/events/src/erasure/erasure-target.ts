import type { ErasureRecord, RuntimeServiceContext, ScopeTarget } from '@keelwerk/core';
import { scopeTargetOf } from '../consumers/scope-target-of.ts';

/** Where an erasure's tenant is served in this process: its source and its tenant-scope target. */
export interface ErasureTarget {
  readonly source: RuntimeServiceContext['namespaces'][number];
  readonly target: ScopeTarget;
}

/** The source and scope a tenant's data lives in here, archived tenants included, or `undefined` when another process holds it. */
export async function erasureTarget(
  context: RuntimeServiceContext,
  record: Pick<ErasureRecord, 'tenantId'>,
): Promise<ErasureTarget | undefined> {
  for (const source of context.namespaces) {
    const target = await scopeTargetOf({
      source,
      scopeId: record.tenantId,
      directory: context.archivedDirectory,
      deploymentId: context.control.deploymentId,
    });
    if (target?.scope.level === 'tenant') return { source, target };
  }
  return undefined;
}
