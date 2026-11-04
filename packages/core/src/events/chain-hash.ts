import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { type ChainFields, chainContent } from './chain-content.ts';

/**
 * `SHA-256(prevHash ‖ JCS(content))` as 64 lower-case hexadecimal characters (section 15.1.8):
 * the UTF-8 bytes of the previous hash's hexadecimal text (nothing for the first event of a
 * chain) followed by the RFC 8785 text of the chain content.
 */
export function chainHash(prevHash: string | null, fields: ChainFields): string {
  return sha256(`${prevHash ?? ''}${canonicalizeJson(chainContent(fields))}`);
}
