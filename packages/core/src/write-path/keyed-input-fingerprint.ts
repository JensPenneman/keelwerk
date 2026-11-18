import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { encodeEventValue } from './encode-event-value.ts';

/**
 * The hex of a command's receipt fingerprint (section 15.1.7, S-111): HMAC-SHA-256 under `key`
 * (HKDF of the scope key with the info `keelwerk/fingerprint/v1`) over the canonical JSON of
 * `{ action, apiVersion, input }`. `commandDigests` calls it with the input whose secret and
 * verifier members are withheld and writes `fingerprintPrefix` before the hex; the 0.1.0 form
 * (`legacyFingerprint`) calls it with the input as given.
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
