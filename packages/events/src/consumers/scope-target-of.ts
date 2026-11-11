import type { QueueSource, ScopeLookup, ScopeTarget } from '@keelwerk/core';

/**
 * Where the log of a scope id of the source's namespace is served: the deployment scope for the
 * deployment's id, else the tenant or backend the directory names, each only when its namespace is
 * the source's. `undefined` when the directory does not know the scope here.
 */
export async function scopeTargetOf(input: {
  readonly source: QueueSource;
  readonly scopeId: string;
  readonly directory: ScopeLookup;
  readonly deploymentId: string;
}): Promise<ScopeTarget | undefined> {
  const { source, scopeId, directory } = input;
  const { namespace, handle } = source;
  if (scopeId === input.deploymentId) return { scope: { level: 'deployment' }, namespace, handle };
  const tenant = await directory.tenant(scopeId);
  if (tenant !== undefined && tenant.namespace.id === namespace.id) {
    return {
      scope: { level: 'tenant', backendId: tenant.backendId, tenantId: tenant.id },
      namespace,
      handle,
    };
  }
  const backend = await directory.backend(scopeId);
  if (backend !== undefined && backend.namespace.id === namespace.id) {
    return { scope: { level: 'backend', backendId: backend.id }, namespace, handle };
  }
  return undefined;
}
