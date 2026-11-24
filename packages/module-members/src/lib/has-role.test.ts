import type { PrincipalContext } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { hasRole } from './has-role.ts';

function contextOf(
  principal: Partial<{
    roles: readonly string[];
    memberships: readonly { kind: string; id: string; role: string }[];
  }>,
): PrincipalContext {
  return {
    principal: { kind: 'user', subject: 'ada', roles: [], memberships: [], ...principal },
    scope: { level: 'deployment' },
    flags: {},
  } as unknown as PrincipalContext;
}

describe('hasRole', () => {
  test('a membership of this module with a listed role passes', () => {
    const ctx = contextOf({
      memberships: [{ kind: 'members.membership', id: 'm1', role: 'admin' }],
    });
    expect(hasRole(ctx, 'admin', 'owner')).toBe(true);
    expect(hasRole(ctx, 'owner')).toBe(false);
    expect(hasRole(ctx)).toBe(false);
  });

  test('a role named only in roles, or a membership of another kind, does not pass', () => {
    expect(hasRole(contextOf({ roles: ['owner'] }), 'owner')).toBe(false);
    const other = contextOf({
      memberships: [{ kind: 'other.membership', id: 'm1', role: 'owner' }],
    });
    expect(hasRole(other, 'owner')).toBe(false);
  });
});
