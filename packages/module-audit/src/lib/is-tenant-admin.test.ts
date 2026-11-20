import type { PrincipalContext } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { isTenantAdmin } from './is-tenant-admin.ts';

const acme = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';
const globex = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';

function context(
  scope: { readonly level: string; readonly tenantId?: string },
  principal: { readonly tenant: string | undefined; readonly roles: readonly string[] },
): PrincipalContext<'user'> {
  return {
    scope,
    principal: { scope: { tenant: principal.tenant }, roles: principal.roles },
  } as unknown as PrincipalContext<'user'>;
}

describe('isTenantAdmin', () => {
  const inAcme = { level: 'tenant', tenantId: acme };

  test('an admin or an owner of the tenant they call in is an admin', () => {
    expect(isTenantAdmin(context(inAcme, { tenant: acme, roles: ['admin'] }))).toBe(true);
    expect(isTenantAdmin(context(inAcme, { tenant: acme, roles: ['owner'] }))).toBe(true);
  });

  test('an admin of another tenant is refused', () => {
    expect(isTenantAdmin(context(inAcme, { tenant: globex, roles: ['admin'] }))).toBe(false);
  });

  test('a principal without admin or owner is refused', () => {
    expect(isTenantAdmin(context(inAcme, { tenant: acme, roles: ['member'] }))).toBe(false);
  });

  test('backend and deployment scope are refused', () => {
    expect(isTenantAdmin(context({ level: 'backend' }, { tenant: acme, roles: ['admin'] }))).toBe(
      false,
    );
    expect(
      isTenantAdmin(context({ level: 'deployment' }, { tenant: acme, roles: ['admin'] })),
    ).toBe(false);
  });
});
