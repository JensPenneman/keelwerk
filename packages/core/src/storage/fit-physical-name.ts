import { sha256 } from '../crypto/sha256.ts';

const hashLength = 8;

/**
 * Keeps a physical name within the dialect's limit: a longer name is truncated and suffixed with
 * 8 hexadecimal characters of the SHA-256 of the full name (section 14.4.2). Names are ASCII by the
 * identifier grammar, so characters and bytes agree.
 */
export function fitPhysicalName(name: string, maxLength: number): string {
  if (name.length <= maxLength) {
    return name;
  }
  return name.slice(0, maxLength - hashLength) + sha256(name).slice(0, hashLength);
}
