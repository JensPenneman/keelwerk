import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { deriveHkdf } from './derive-hkdf.ts';

/** The HKDF info of a prefix's verifier key (S-32). */
function tokenVerifierInfo(prefix: string): string {
  return `keelwerk/token-verifier/1/${prefix}`;
}

/** The stored verifier of a token secret: HMAC-SHA-256 of the secret text under HKDF-SHA-256 of the scope key, as 64 hex characters. */
export function tokenVerifier(scopeKey: Uint8Array, prefix: string, secret: string): string {
  return hmacSha256(deriveHkdf(scopeKey, '', tokenVerifierInfo(prefix), 32), secret);
}
