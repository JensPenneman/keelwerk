import { principalValueKeyPrefix } from './principal-value-key-prefix.ts';

/** Whether a value key is one of a principal's (`principalValueKeyId`), not a per-value key. */
export function isPrincipalValueKeyId(keyId: string): boolean {
  return keyId.startsWith(principalValueKeyPrefix);
}
