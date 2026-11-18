import { hmacSha256 } from '../crypto/hmac-sha256.ts';
import { deriveHkdf } from '../keys/derive-hkdf.ts';
import { encodeAad } from '../keys/encode-aad.ts';
import type { DataKey } from '../storage/data-key.ts';
import { decisionDigestPrefix } from './decision-digest-prefix.ts';

/**
 * The input digest a decision record holds (7.9.6, WP-130, WP-158): the decision base (`kwb1.`, the
 * command's digest with every secret, verifier and personal member withheld) itself when the
 * decision sealed no personal value, else `kwd1.` and the HMAC-SHA-256 of the whole current text
 * under K, with K = HKDF(the materials of the data keys in key id order, '', the AAD of
 * `keelwerk/decision-digest/v1` and the sorted distinct key ids, 32). The shred of any of the keys
 * makes the digest uncheckable wherever the record is kept, and the record is covered by the chain
 * hash, so it cannot be scrubbed afterwards. The order of `keys` and a key given twice do not
 * matter; a `kwd1.` text rekeyed answers a `kwd1.` text. This is a stored format.
 */
export function decisionDigest(base: string, keys: readonly DataKey[]): string {
  if (keys.length === 0) return base;
  const byId = new Map<string, DataKey>();
  for (const key of keys) byId.set(key.id, key);
  const ids = [...byId.keys()].sort();
  const material = Buffer.concat(ids.map((id) => byId.get(id)?.material ?? new Uint8Array(0)));
  const secret = deriveHkdf(material, '', encodeAad(['keelwerk/decision-digest/v1', ...ids]), 32);
  return decisionDigestPrefix + hmacSha256(secret, base);
}
