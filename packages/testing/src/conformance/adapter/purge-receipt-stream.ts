import type { StorageScope } from '@keelwerk/core';
import { commandReceiptUuid } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { purgeCommandOf } from './purge-command-of.ts';
import { purgeReceiptType } from './purge-receipt-type.ts';

/** The change stream of the receipt of command `number` in a tenant. */
export function purgeReceiptStream(
  number: number,
  scope: StorageScope = conformanceScopes.tenantA,
): { readonly type: string; readonly id: string } {
  if (scope.level !== 'tenant') throw new Error('a tenant scope');
  return {
    type: purgeReceiptType,
    id: commandReceiptUuid(scope.tenantId, purgeCommandOf(number)),
  };
}
