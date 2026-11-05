import { operatorTokenPrefix } from '../../core-module/operator-token-prefix.ts';
import type { Carrier } from '../carrier.ts';

/**
 * The operator token a carrier presents (section 3.5, S-32): the transport's bearer token, or the
 * bearer of the `Authorization` header, when it starts with the operator prefix. `undefined` for
 * every other credential, which the app's own resolvers handle.
 */
export function operatorTokenOf(carrier: Carrier): string | undefined {
  const header = carrier.headers?.authorization;
  const bearer =
    carrier.token ??
    (header?.toLowerCase().startsWith('bearer ') === true ? header.slice(7).trim() : undefined);
  return bearer?.startsWith(`${operatorTokenPrefix}_`) === true ? bearer : undefined;
}
