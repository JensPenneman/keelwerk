import { coreError } from '@keelwerk/core/http';

const maxActionBytes = 256;
const encoder = new TextEncoder();

/** The reference of a subscription: a non-empty string of at most 256 bytes; anything else is `core.malformed_request`, without the value. */
export function subscriptionRefOf(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    encoder.encode(value).byteLength > maxActionBytes
  ) {
    throw coreError('core.malformed_request', {
      issues: [{ path: ['action'], message: 'Expected the reference of a subscription.' }],
    });
  }
  return value;
}
