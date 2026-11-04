import type { NamespaceRef } from '@keelwerk/core';

/** The control store's namespace: where deployment-scope units run. */
export const storeControlNamespace: NamespaceRef = {
  id: 'ns-control',
  placementId: 'pglite',
  appId: 'control',
  tenantId: null,
  root: 'kw__control',
};
