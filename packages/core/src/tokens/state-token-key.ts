import type { KeyService } from '../kernel/key-service.ts';
import type { Scope } from '../storage/scope.ts';
import { stateTokenKeyInfo } from './state-token-key-info.ts';

/**
 * The key that seals the state tokens of a scope: HKDF of the scope key with the info
 * `keelwerk/state-token/v2` (section 15.2.6). Derived once for an invocation or a kernel and carried
 * in the `StateTokenContext`, so that issuing and checking a token stay synchronous.
 */
export function stateTokenKey(keys: KeyService, scope: Scope): Promise<Uint8Array> {
  return keys.derive(scope, stateTokenKeyInfo, 32);
}
