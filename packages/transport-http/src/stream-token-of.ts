import { decodeStateToken } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';

const maxTokenLength = 128;
const tokenPattern = /^[0-9a-z.]+$/;

/** The values never reach the message: a hostile token is never echoed or logged. */
function malformed(name: string) {
  return coreError('core.malformed_request', {
    issues: [{ path: [name], message: 'Expected one stream token.' }],
  });
}

/**
 * One stream token of at most 128 characters of `0-9`, `a-z` and `.` in the form of a state token;
 * anything else is `core.malformed_request` under `name`, without the value. The form only (the check
 * is the hub's to verify): a token that cannot be read at all is refused before the stream starts, so
 * a client does not reconnect for ever with the same one.
 */
export function streamTokenOf(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > maxTokenLength || !tokenPattern.test(value)) {
    throw malformed(name);
  }
  try {
    decodeStateToken(value);
  } catch {
    throw malformed(name);
  }
  return value;
}
