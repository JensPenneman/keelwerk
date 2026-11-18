import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { defaultRandomSource } from '../keys/default-random-source.ts';
import { isForkable } from '../keys/is-forkable.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import { fingerprintKeyInfo } from '../write-path/fingerprint-key-info.ts';

/**
 * The key of the digests a dry run computes, taken before its unit opens. A key service that forks
 * derives from the in-memory fork (a scope without a key gets one there). One that cannot fork only
 * reads the scope key that exists, because creating one would commit outside the rollback; a scope
 * without a key then digests under a random key that lives for this dry run alone, so the digests
 * still have the form of a real run's.
 */
export async function dryRunFingerprintKey(
  real: KeyService,
  dry: KeyService,
  scope: StorageScope,
): Promise<Uint8Array> {
  if (isForkable(real)) return dry.derive(scope, fingerprintKeyInfo, 32);
  try {
    return await real.derive(scope, fingerprintKeyInfo, 32, { create: false });
  } catch (error) {
    if (error instanceof KeelwerkError && error.kind === 'not_found') {
      return defaultRandomSource(32);
    }
    throw error;
  }
}
