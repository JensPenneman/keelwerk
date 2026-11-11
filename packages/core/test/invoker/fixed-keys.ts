import type { KeyService } from '../../src/kernel/key-service.ts';
import { deriveHkdf } from '../../src/keys/derive-hkdf.ts';

/** A key service that only derives: HKDF of one fixed key, salted with the scope, so every scope has its own keys. */
export const fixedKeys = (secret = 7): KeyService =>
  ({
    derive: (scope: unknown, info: string, length: number) =>
      Promise.resolve(
        deriveHkdf(new Uint8Array(32).fill(secret), JSON.stringify(scope), info, length),
      ),
  }) as unknown as KeyService;
