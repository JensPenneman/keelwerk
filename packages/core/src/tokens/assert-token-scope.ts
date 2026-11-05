import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Scope } from '../storage/scope.ts';
import type { StateTokenParts } from './state-token-parts.ts';
import { tokenScopePart } from './token-scope-part.ts';

/** A token whose scope part belongs to another scope is `core.token_scope_mismatch` (section 15.2.6). */
export function assertTokenScope(parts: StateTokenParts, scope: Scope): void {
  if (parts.scope === tokenScopePart(scope)) return;
  throw new KeelwerkError({
    kind: 'validation',
    code: 'core.token_scope_mismatch',
    message: 'The token belongs to another scope.',
  });
}
