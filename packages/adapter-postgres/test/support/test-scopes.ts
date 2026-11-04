import type { StorageScope } from '@keelwerk/core';

const backendId = '00000000-0000-4000-8000-0000000000b1';
const tenantA = '00000000-0000-4000-8000-0000000000a1';
const tenantB = '00000000-0000-4000-8000-0000000000a2';

/** The fixed ids and scopes the tests share. */
export const testScopes: {
  readonly backendId: string;
  readonly tenantA: string;
  readonly tenantB: string;
  readonly deploymentId: string;
  readonly scopeA: StorageScope;
  readonly scopeB: StorageScope;
} = {
  backendId,
  tenantA,
  tenantB,
  deploymentId: '00000000-0000-4000-8000-0000000000d1',
  scopeA: { level: 'tenant', backendId, tenantId: tenantA },
  scopeB: { level: 'tenant', backendId, tenantId: tenantB },
};
