import type { Principal } from '@keelwerk/core';
import { sessionResolverId } from './session-resolver-id.ts';

/**
 * Whether a person is signed in with a session of this module. The kernel checks that the reference
 * of a resolver's answer names that resolver, so another credential (an API key, say) never passes
 * for a session, whatever else it claims.
 */
export function signedInBySession(principal: Principal): boolean {
  return principal.kind === 'user' && principal.ref?.resolver === sessionResolverId;
}
