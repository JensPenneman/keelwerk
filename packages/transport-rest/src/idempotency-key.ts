import { coreError } from './core-error.ts';

const visibleAscii = /^[\x21-\x7e]{1,255}$/;

/** The client's `Idempotency-Key`, an opaque string of 1 to 255 visible characters (section 16.4.8). */
export function idempotencyKey(headers: Headers): string | undefined {
  const value = headers.get('idempotency-key')?.trim();
  if (value === undefined) {
    return undefined;
  }
  if (!visibleAscii.test(value)) {
    throw coreError('core.malformed_request', {
      message: 'Idempotency-Key must be 1 to 255 visible ASCII characters.',
    });
  }
  return value;
}
