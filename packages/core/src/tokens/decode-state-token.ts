import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { StateTokenParts } from './state-token-parts.ts';

const pattern =
  /^v([12])\.(0|[1-9a-z][0-9a-z]{0,9})\.(0|[1-9][0-9]*)\.([0-9a-f]{8})\.([0-9a-f]{8}|[0-9a-f]{32})$/;

/** Reads a state token of either format; anything else is a `validation` error with the code `core.malformed_request`. */
export function decodeStateToken(token: string): StateTokenParts {
  const match = pattern.exec(token);
  if (match === null) {
    throw new KeelwerkError({
      kind: 'validation',
      code: 'core.malformed_request',
      message: 'The state token is malformed.',
      details: { issues: [{ path: ['state'], message: 'Not a state token.' }] },
    });
  }
  const [, version = '', epoch = '', position = '', scope = '', check = ''] = match;
  return {
    version: version === '1' ? 1 : 2,
    epoch: Number.parseInt(epoch, 36),
    position: BigInt(position),
    scope,
    check,
  };
}
