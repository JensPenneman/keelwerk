import type { KeyService } from '../kernel/key-service.ts';
import type { StorageScope } from '../storage/storage-scope.ts';

/**
 * The HKDF info of an index root key version. The root is derived from the scope's key through the
 * key service (the seam of 14.7.9.7: M1 keeps no `kw_index_keys` store, so a root is the scope
 * key's HKDF under this info, and a rotation is a new version).
 */
function rootInfo(version: number): string {
  return `keelwerk/index-root/${version}`;
}

/** The index root key of a scope at a version: 256 bits. */
export function indexRootKey(
  keys: Pick<KeyService, 'derive'>,
  scope: StorageScope,
  version: number,
): Promise<Uint8Array> {
  return keys.derive(scope, rootInfo(version), 32);
}
