import { errors } from '../errors/errors.ts';
import type { IssuedSecret } from '../kernel/issued-secret.ts';
import { encodeBase32 } from './encode-base32.ts';
import { isTokenPrefix } from './is-token-prefix.ts';
import type { RandomSource } from './random-source.ts';
import { tokenVerifier } from './token-verifier.ts';

/**
 * Issues a token `<prefix>_<public id>_<secret>` (S-32): a 128-bit public id and a secret of
 * `bytes` (default 32, at least 16) random bytes, both in lower-case base32. The plain token is
 * handed to the caller once; only the public id and the verifier are kept.
 */
export function issueSecret(
  scopeKey: Uint8Array,
  options: { readonly prefix: string; readonly bytes?: number },
  random: RandomSource,
): IssuedSecret {
  if (!isTokenPrefix(options.prefix)) {
    throw errors.validation('A token prefix is lower-case letters and digits, at most 16.');
  }
  const bytes = options.bytes ?? 32;
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128) {
    throw errors.validation('A token secret has 16 to 128 bytes.');
  }
  const publicId = encodeBase32(random(16));
  const secret = encodeBase32(random(bytes));
  return {
    publicId,
    plain: `${options.prefix}_${publicId}_${secret}`,
    verifier: tokenVerifier(scopeKey, options.prefix, secret),
  };
}
