import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { StateTokenSource } from './state-token-parts.ts';

/**
 * The check a token of the current format carries (section 15.2.6): the first 16 bytes
 * (32 hexadecimal characters, 128 bits) of HMAC-SHA-256, under the scope's token key (`stateTokenKey`), over the format
 * version, the epoch, the position, the scope and the check of the token's selector. The holder of
 * a token does not have the key, so it cannot change a part and make the check fit: a token whose
 * position was altered fails like a forged one, and a guess needs about 2^128 requests.
 */
export function sealTokenCheck(source: StateTokenSource, key: Uint8Array): string {
  return hmacSha256(
    key,
    canonicalizeJson({
      version: 2,
      epoch: source.epoch,
      position: source.position.toString(),
      scope: source.scope,
      check: source.check,
    }),
  ).slice(0, 32);
}
