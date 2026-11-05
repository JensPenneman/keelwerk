import type { StorageScope } from '../storage/storage-scope.ts';

/** Derives key material from a scope's key; the key service's `derive`. */
export type DeriveScopeKey = (
  scope: StorageScope,
  info: string,
  length: number,
) => Promise<Uint8Array>;
