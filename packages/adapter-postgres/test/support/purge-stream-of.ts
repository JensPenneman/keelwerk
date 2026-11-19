import type { StorageScope } from '@keelwerk/core';
import { commandReceiptUuid } from '@keelwerk/core';

/** The id of the change stream of the receipt of command `c<stream>` in a tenant scope. */
export function purgeStreamOf(stream: number, scope: StorageScope): string {
  if (scope.level !== 'tenant') throw new Error('a tenant scope');
  return commandReceiptUuid(scope.tenantId, `c${stream}`);
}
