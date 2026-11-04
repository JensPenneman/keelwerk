import type { NamespaceRef } from '@keelwerk/core';

/** The application namespace the tests provision. */
export const testNamespace: NamespaceRef = {
  id: 'ns-app',
  placementId: 'main',
  appId: 'app',
  tenantId: null,
  root: 'app',
};
