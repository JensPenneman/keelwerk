import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import type { KeyService } from '../kernel/key-service.ts';
import type { StorageScope } from '../storage/storage-scope.ts';

/** The purpose and version the bucket key is derived under (S-36). */
const bucketKeyInfo = 'keelwerk/bucket/1';

/**
 * The stored name of a bucket (S-36, S-86): HMAC-SHA-256 of the contributing module and the rule's
 * key (an address, an identifier) under a key derived from the scope's key, so no plain address is
 * stored, the same address names a different row in every scope, and two modules naming the same
 * bucket never share a row.
 */
export async function bucketKey(
  keys: KeyService,
  scope: StorageScope,
  module: string,
  bucket: string,
): Promise<string> {
  const key = await keys.derive(scope, bucketKeyInfo, 32);
  return hmacSha256(key, `${module}\u0000${bucket}`);
}
