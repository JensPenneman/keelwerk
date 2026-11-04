import { timingSafeEqual } from '../crypto/timing-safe-equal.ts';
import { parseToken } from './parse-token.ts';
import { tokenVerifier } from './token-verifier.ts';

/** Whether `token` matches `verifier` under the scope key, compared in constant time; a malformed token is `false`. */
export function verifySecret(scopeKey: Uint8Array, token: string, verifier: string): boolean {
  const parsed = parseToken(token);
  if (parsed === undefined) return false;
  return timingSafeEqual(tokenVerifier(scopeKey, parsed.prefix, parsed.secret), verifier);
}
