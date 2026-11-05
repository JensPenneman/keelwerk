import { parseToken } from '@keelwerk/core';
import { sessionTokenPrefix } from './session-token-prefix.ts';

/** What a presented token is to the session resolver. */
export type SessionToken =
  | { readonly kind: 'session'; readonly publicId: string }
  | { readonly kind: 'foreign' }
  | { readonly kind: 'malformed' };

/** A token of another module (API key, node credential) is `foreign`: not this resolver's to refuse. */
export function parseSessionToken(token: string): SessionToken {
  const parsed = parseToken(token);
  if (parsed === undefined) return { kind: 'malformed' };
  return parsed.prefix === sessionTokenPrefix
    ? { kind: 'session', publicId: parsed.publicId }
    : { kind: 'foreign' };
}
