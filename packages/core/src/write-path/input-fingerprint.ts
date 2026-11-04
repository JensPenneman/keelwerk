import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { encodeEventValue } from './encode-event-value.ts';

/**
 * The digest of a command's input and the API version its outcome is expressed in (section
 * 15.1.7), over the canonical JSON of both: the same request always has the same fingerprint, and
 * another input or version never does.
 */
export function inputFingerprint(action: string, apiVersion: string, input: unknown): string {
  return sha256(canonicalizeJson({ action, apiVersion, input: encodeEventValue(input) ?? null }));
}
