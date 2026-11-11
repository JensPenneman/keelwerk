import type { KeyService } from '../kernel/key-service.ts';
import type { Scope } from '../storage/scope.ts';
import type { StateTokenContext } from './state-token-context.ts';
import { stateTokenKey } from './state-token-key.ts';

/**
 * The keys a read in `scope` seals its tokens with: the scope's own and, for a tenant read, the
 * key of the tenant's backend scope, which backend entities are loaded in (14.3.6). A token names
 * the scope the load read, so it is sealed with that scope's key and the entity's own `changes`
 * accepts it.
 */
export async function stateTokenSealing(
  keys: KeyService,
  scope: Scope,
): Promise<Pick<StateTokenContext, 'sealKey' | 'sealKeyOf'>> {
  const sealKey = await stateTokenKey(keys, scope);
  if (scope.level !== 'tenant') return { sealKey };
  const backend: Scope = { level: 'backend', backendId: scope.backendId };
  const backendKey = await stateTokenKey(keys, backend);
  return { sealKey, sealKeyOf: (of) => (of.level === 'backend' ? backendKey : sealKey) };
}
