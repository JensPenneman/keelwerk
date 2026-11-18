import { createHmac } from 'node:crypto';
import type { KeyService, StorageScope } from '@keelwerk/core';
import { encodeAad, jobKeyInfo } from '@keelwerk/core';

/**
 * The digest a job key is stored under: HMAC-SHA-256 of the owner (the module or the reaction id)
 * and the key text under the job key secret of the scope, computed outside the kernel. The one
 * copy of the formula for the tests of this package.
 */
export async function storedJobKeyDigest(
  keys: Pick<KeyService, 'derive'>,
  scope: StorageScope,
  owner: string,
  key: string,
): Promise<string> {
  const secret = await keys.derive(scope, jobKeyInfo, 32);
  return createHmac('sha256', secret)
    .update(encodeAad([owner, key]))
    .digest('hex');
}
