import type { NamespaceRef, Scope } from '@keelwerk/core';
import { harnessAddress } from '../harness/harness-address.ts';
import { harnessNamespaceId } from '../harness/harness-namespace-id.ts';
import type { TestApp } from '../harness/test-app.ts';
import type { TestRuntime } from '../harness/test-runtime.ts';
import type { TestTenant } from '../harness/test-tenant.ts';

/** Where a tenant of a test runtime keeps its data: the namespace and the scope its units open. */
export interface TenantAddress {
  readonly tenant: TestTenant;
  readonly namespace: NamespaceRef;
  readonly scope: Scope;
}

/**
 * The address `startTestRuntime` gives a tenant: one namespace per tenant on the placement
 * `main`, under the runtime's single backend. The ids come from the harness.
 */
export function tenantAddress(runtime: TestRuntime<TestApp>, tenantName?: string): TenantAddress {
  const tenants = Object.values(runtime.tenants);
  const tenant =
    tenantName === undefined
      ? tenants[0]
      : tenants.find((candidate) => candidate.name === tenantName);
  if (tenant === undefined) {
    throw new Error(`The test runtime has no tenant ${tenantName ?? '(any)'}.`);
  }
  return {
    tenant,
    namespace: {
      id: harnessNamespaceId(tenant.id),
      placementId: harnessAddress.placementId,
      appId: runtime.app.id,
      tenantId: tenant.id,
      root: runtime.app.id,
    },
    scope: {
      level: 'tenant',
      backendId: harnessAddress.backendId,
      tenantId: tenant.id,
    },
  };
}
