import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { encodeEventValue } from './encode-event-value.ts';

/**
 * The 0.1.0 form of a command's fingerprint (section 15.1.7): the plain sha256 of the canonical
 * JSON of `{ action, apiVersion, input }`. Nothing writes it any more; `legacyFingerprint` computes
 * it to compare a receipt or a decision that 0.1.0 wrote.
 */
export function inputFingerprint(action: string, apiVersion: string, input: unknown): string {
  return sha256(canonicalizeJson({ action, apiVersion, input: encodeEventValue(input) ?? null }));
}
