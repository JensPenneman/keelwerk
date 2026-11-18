import { deriveHkdf } from '../src/keys/derive-hkdf.ts';
import { fingerprintKeyInfo } from '../src/write-path/fingerprint-key-info.ts';

/**
 * The fingerprint key of a fixed scope key: HKDF of 32 bytes of 7 with the info of the fingerprint.
 */
export const testFingerprintKey: Uint8Array = deriveHkdf(
  new Uint8Array(32).fill(7),
  '',
  fingerprintKeyInfo,
  32,
);
