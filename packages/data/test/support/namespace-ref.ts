import type { NamespaceRef } from '@keelwerk/core';
import { ns } from './ns.ts';

/** The reference of the namespace the PGlite tests provision at `ns`. */
export const namespaceRef: NamespaceRef = {
  id: 'ns-tables-test',
  placementId: 'pglite',
  appId: 'tables',
  tenantId: null,
  root: ns,
};
