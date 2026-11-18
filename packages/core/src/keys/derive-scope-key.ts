import type { StorageScope } from '../storage/storage-scope.ts';

/**
 * Derives key material from a scope's key; the key service's `derive`. With `create: false` a scope
 * without a key is `not_found` and no key is created.
 */
export type DeriveScopeKey = (
  scope: StorageScope,
  info: string,
  length: number,
  options?: { readonly create?: false },
) => Promise<Uint8Array>;
