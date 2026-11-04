import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';

/** 'sha256-' plus the base64url of SHA-256 over the RFC 8785 form of a value (section 16.2.2). */
export function surfaceHash(value: unknown): string {
  return `sha256-${Buffer.from(sha256(canonicalizeJson(value)), 'hex').toString('base64url')}`;
}
