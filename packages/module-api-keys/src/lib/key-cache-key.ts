import { sha256 } from '@keelwerk/core/crypto';

/** The key the kernel caches a resolved key principal under: a digest of the whole token, never its public id alone. */
export function keyCacheKey(token: string): string {
  return `api-keys.key:${sha256(token)}`;
}
