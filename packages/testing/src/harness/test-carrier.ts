import type { Carrier } from '@keelwerk/core';
import type { TestPrincipal } from './test-principal.ts';
import { testPrincipalHeader } from './test-principal-header.ts';
import type { TestTenant } from './test-tenant.ts';

/** The carrier of an in-process call: the tenant by header and the principal as plain data. */
export function testCarrier(tenant: TestTenant, principal: TestPrincipal): Carrier {
  return {
    transport: 'test',
    headers: { 'x-tenant': tenant.id, [testPrincipalHeader]: JSON.stringify(principal) },
  };
}
