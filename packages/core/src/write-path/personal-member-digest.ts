import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { deriveHkdf } from '../keys/derive-hkdf.ts';
import type { DataKey } from '../storage/data-key.ts';
import { encodeEventValue } from './encode-event-value.ts';

const info = 'keelwerk/fingerprint/personal/v1';

/**
 * The digest of one personal member of a command's input, as the fingerprint holds it instead of
 * the value: HMAC-SHA-256 under HKDF(the subject's data key, '',
 * `keelwerk/fingerprint/personal/v1`, 32) over the canonical JSON of the action, the member name
 * and the value in its event form, as 64 lower-case hexadecimal characters. The key is the
 * subject's own, so the shred of the subject makes the digest uncheckable wherever it is kept
 * (receipt, decision record); the action and the member are in the message, so the same value under
 * another member or another action never matches.
 */
export function personalMemberDigest(
  key: DataKey,
  action: string,
  member: string,
  value: unknown,
): string {
  return hmacSha256(
    deriveHkdf(key.material, '', info, 32),
    canonicalizeJson({ action, member, value: encodeEventValue(value) ?? null }),
  );
}
