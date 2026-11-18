import { refuseReservedCommandId } from '@keelwerk/core';
import { coreError, isCommandId } from '@keelwerk/core/http';

/**
 * The client's `Idempotency-Key`, an opaque id, a UUID of version 4 or 7, or a ULID (section
 * 16.4.8).
 */
export function idempotencyKey(headers: Headers): string | undefined {
  const value = headers.get('idempotency-key')?.trim();
  if (value === undefined) {
    return undefined;
  }
  // The kernel's own form is refused as reserved, before the grammar of a caller's id applies.
  refuseReservedCommandId(value);
  if (!isCommandId(value)) {
    throw coreError('core.malformed_request', {
      message: 'Idempotency-Key: Expected a UUID of version 4 or 7, or a ULID.',
    });
  }
  return value;
}
