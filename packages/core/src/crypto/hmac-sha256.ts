import { createHmac } from 'node:crypto';

/** HMAC-SHA-256 (RFC 2104) of `data` under `key`, as 64 lower-case hexadecimal characters. */
export function hmacSha256(key: string | Uint8Array, data: string | Uint8Array): string {
  return createHmac('sha256', key).update(data).digest('hex');
}
