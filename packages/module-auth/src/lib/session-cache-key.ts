import { sha256 } from '@keelwerk/core/crypto';

/**
 * The key the kernel caches a resolved session under (17.2.4): a digest of the whole presented
 * token, never its public id alone, so a request that knows only the public id cannot reach the
 * cached principal of that session.
 */
export function sessionCacheKey(token: string): string {
  return `auth.session:${sha256(token)}`;
}
