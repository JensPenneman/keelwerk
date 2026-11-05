import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { encodeEventValue } from './encode-event-value.ts';

/**
 * The fingerprint of a command whose input carries sealed or secret members (section 15.1.7,
 * S-111): HMAC-SHA-256 under `key` (HKDF of the scope key with the info `keelwerk/fingerprint/v1`) over the
 * canonical JSON `inputFingerprint` hashes, so a reader of receipts and decision records cannot
 * check guesses of a plaintext secret against the digest.
 */
export function keyedInputFingerprint(
  key: Uint8Array,
  action: string,
  apiVersion: string,
  input: unknown,
): string {
  return hmacSha256(
    key,
    canonicalizeJson({ action, apiVersion, input: encodeEventValue(input) ?? null }),
  );
}
