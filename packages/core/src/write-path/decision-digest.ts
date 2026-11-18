import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { deriveHkdf } from '../keys/derive-hkdf.ts';
import { encodeAad } from '../keys/encode-aad.ts';
import type { DataKey } from '../storage/data-key.ts';

/**
 * The input digest a decision record holds (7.9.6, WP-130): the command's fingerprint itself when
 * the decision sealed no personal value, else HMAC-SHA-256 of the fingerprint under K, with K =
 * HKDF(the materials of the data keys in key id order, '', the AAD of `keelwerk/decision-digest/v1`
 * and the sorted distinct key ids, 32). The shred of any of the keys makes the digest uncheckable
 * wherever the record is kept, and the record is covered by the chain hash, so it cannot be
 * scrubbed afterwards. The order of `keys` and a key given twice do not matter. 64 hex characters.
 */
export function decisionDigest(fingerprint: string, keys: readonly DataKey[]): string {
  if (keys.length === 0) return fingerprint;
  const byId = new Map<string, DataKey>();
  for (const key of keys) byId.set(key.id, key);
  const ids = [...byId.keys()].sort();
  const material = Buffer.concat(ids.map((id) => byId.get(id)?.material ?? new Uint8Array(0)));
  const secret = deriveHkdf(material, '', encodeAad(['keelwerk/decision-digest/v1', ...ids]), 32);
  return hmacSha256(secret, fingerprint);
}
