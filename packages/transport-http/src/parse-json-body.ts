import { coreError } from './core-error.ts';

/** Parses a JSON body into a value; anything else is `core.malformed_request`. */
export function parseJsonBody(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw coreError('core.malformed_request', { message: 'The body is not valid JSON.' });
  }
}
