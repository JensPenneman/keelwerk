import { jobKeyInfo } from '../effects/job-key-info.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import { stateTokenKeyInfo } from '../tokens/state-token-key-info.ts';
import { fingerprintKeyInfo } from '../write-path/fingerprint-key-info.ts';
import type { ScopeSecrets } from './scope-secrets.ts';

/**
 * Derives the secrets a write takes from the scope key, before the unit of that scope opens, and
 * creates the scope key when the scope has none (a creation runs in a unit of its own), unless
 * `create` is `false`: a reader that must not write then gets `not_found` for a scope without a
 * key. The unit then uses the secrets it was handed and derives nothing (a unit never asks the key
 * service; what a unit needs is added here): a derivation inside a unit would open a second unit
 * once the key service's cache has expired, which hangs on an adapter that runs one unit at a
 * time, however long the preparation or a retry's backoff before it took.
 */
export async function deriveScopeSecrets(
  keys: KeyService,
  scope: StorageScope,
  options?: { readonly create?: false },
): Promise<ScopeSecrets> {
  const jobKey = await keys.derive(scope, jobKeyInfo, 32, options);
  const fingerprintKey = await keys.derive(scope, fingerprintKeyInfo, 32, options);
  const stateTokenKey = await keys.derive(scope, stateTokenKeyInfo, 32, options);
  return { jobKey, fingerprintKey, stateTokenKey };
}
