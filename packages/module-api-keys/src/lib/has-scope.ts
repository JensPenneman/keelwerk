import type { PrincipalContext } from '@keelwerk/core';
import { keyResolverId } from './key-resolver-id.ts';
import type { KeyScope } from './key-scope.ts';

/** Whether the principal came from a key that holds `scope`. */
export function hasScope(ctx: PrincipalContext, scope: KeyScope): boolean {
  const { via, claims } = ctx.principal;
  if (via !== keyResolverId) return false;
  const { scopes } = claims;
  return Array.isArray(scopes) && scopes.includes(scope);
}
