import type { KeyService } from '@keelwerk/core';
import { deriveHkdf } from '@keelwerk/core';

/** A key service that only derives: HKDF of one fixed key, salted with the scope, so every scope has its own keys. */
export const deriveOnlyKeys = {
  derive: (scope: unknown, info: string, length: number) =>
    Promise.resolve(deriveHkdf(new Uint8Array(32).fill(7), JSON.stringify(scope), info, length)),
} as unknown as KeyService;
