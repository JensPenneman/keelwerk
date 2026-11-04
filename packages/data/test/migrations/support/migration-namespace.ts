import type { NamespaceRef } from '@keelwerk/core';

/** The namespace the migration tests provision. */
export const migrationNamespace: NamespaceRef = {
  id: 'migrations-test',
  placementId: 'pglite',
  appId: 'conformance',
  tenantId: null,
  root: 'migrations_test',
};
