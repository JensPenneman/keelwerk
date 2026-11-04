import { createHash } from 'node:crypto';

/** SHA-256 of a string (UTF-8) or of bytes, as 64 lower-case hexadecimal characters. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
