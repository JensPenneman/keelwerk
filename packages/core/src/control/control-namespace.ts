import type { NamespaceRef } from '../storage/namespace-ref.ts';

/** The physical root of the control store (S-09): no app id maps to a name with two underscores. */
const controlRoot = 'kw__control';

/** The control store's namespace: the deployment-scope data of the core module. */
export function controlNamespace(placementId: string): NamespaceRef {
  return { id: 'ns-control', placementId, appId: 'core', tenantId: null, root: controlRoot };
}
