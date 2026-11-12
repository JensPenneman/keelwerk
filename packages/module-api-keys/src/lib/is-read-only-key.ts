import type { PrincipalContext } from '@keelwerk/core';
import { hasScope } from './has-scope.ts';
import { keyResolverId } from './key-resolver-id.ts';

/** Whether the principal came from a key that holds no `write` scope. */
export function isReadOnlyKey(ctx: PrincipalContext): boolean {
  return ctx.principal.via === keyResolverId && !hasScope(ctx, 'write');
}
