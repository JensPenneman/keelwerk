import type { NamespaceRef, Scope } from '@keelwerk/core';
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
 * The address of a tenant of a running test runtime: the namespace the runtime provisioned for the
 * app and the tenant scope under the backend it created. The ids come from the runtime.
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
    namespace: runtime.namespace,
    scope: {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: tenant.id,
    },
  };
}
