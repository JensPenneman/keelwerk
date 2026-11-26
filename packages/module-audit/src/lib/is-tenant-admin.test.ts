import type { Membership, PrincipalContext } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { isTenantAdmin } from './is-tenant-admin.ts';

const acme = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';
const globex = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';

function context(
  scope: { readonly level: string; readonly tenantId?: string },
  principal: {
    readonly tenant: string | undefined;
    readonly roles?: readonly string[];
    readonly memberships?: readonly Membership[];
  },
): PrincipalContext<'user'> {
  return {
    scope,
    principal: {
      scope: { tenant: principal.tenant },
      roles: principal.roles ?? [],
      memberships: principal.memberships ?? [],
    },
  } as unknown as PrincipalContext<'user'>;
}

const held = (role: string, kind = 'members.membership'): readonly Membership[] => [
  { kind, id: 'm1', role },
];

describe('isTenantAdmin', () => {
  const inAcme = { level: 'tenant', tenantId: acme };

  test('roles alone make no admin', () => {
    expect(isTenantAdmin(context(inAcme, { tenant: acme, roles: ['admin', 'owner'] }))).toBe(false);
  });

  test("members' admin or owner of this tenant is one", () => {
    expect(isTenantAdmin(context(inAcme, { tenant: acme, memberships: held('admin') }))).toBe(true);
    expect(isTenantAdmin(context(inAcme, { tenant: acme, memberships: held('owner') }))).toBe(true);
  });

  test('a membership of another kind is none', () => {
    // The members module's prefix is no kind either: only its exact kind counts.
    for (const kind of ['other.membership', 'members.other']) {
      for (const role of ['admin', 'owner']) {
        const memberships = held(role, kind);
        expect(isTenantAdmin(context(inAcme, { tenant: acme, memberships }))).toBe(false);
      }
    }
  });

  test('an admin of another tenant is refused', () => {
    expect(isTenantAdmin(context(inAcme, { tenant: globex, memberships: held('admin') }))).toBe(
      false,
    );
  });

  test('a member without admin or owner is refused', () => {
    expect(isTenantAdmin(context(inAcme, { tenant: acme, memberships: held('member') }))).toBe(
      false,
    );
  });

  test('backend and deployment scope are refused', () => {
    // No tenant on either side, so that only the line on the scope's level can refuse.
    for (const level of ['backend', 'deployment']) {
      expect(
        isTenantAdmin(context({ level }, { tenant: undefined, memberships: held('admin') })),
      ).toBe(false);
    }
  });
});
