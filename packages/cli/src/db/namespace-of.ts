import type { NamespaceRef } from '@keelwerk/core';
import { namespaceRootOf } from '@keelwerk/core';

/** The shared-tables namespace of an app on a placement (S-09): the id is only a label here, the root decides the schema. */
export function namespaceOf(placement: string, appId: string): NamespaceRef {
  return {
    id: `${placement}/${appId}`,
    placementId: placement,
    appId,
    tenantId: null,
    root: namespaceRootOf(appId),
  };
}
