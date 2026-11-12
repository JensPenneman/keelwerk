import type { Carrier } from '@keelwerk/core';
import type { TestPrincipal } from './test-principal.ts';
import { testPrincipalHeader } from './test-principal-header.ts';
import type { TestTenant } from './test-tenant.ts';

/** The carrier of an in-process call: the tenant by header, the principal as plain data and the client address the call comes from when given (the local client names a fresh one for each call, so no address limit is shared between calls). */
export function testCarrier(
  tenant: TestTenant,
  principal: TestPrincipal,
  address?: string,
): Carrier {
  return {
    transport: 'test',
    ...(address !== undefined && {
      connection: {
        id: 'test',
        listener: 'test',
        remote: { address, port: 40_000 },
        local: { address: '127.0.0.1', port: 8080 },
      },
    }),
    headers: { 'x-tenant': tenant.id, [testPrincipalHeader]: JSON.stringify(principal) },
  };
}
