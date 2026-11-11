import { errors, type SurfaceAction } from '@keelwerk/core';
import { applyCookieHint, keepMasked } from '@keelwerk/core/http';
import { toWire } from '@keelwerk/core/wire';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import type { GraphqlContext } from './graphql-context.ts';

/**
 * The one encoding of an action's output: `toWire` over the output node with the `$masked` member
 * put back, then the cookie hint (the cookie to set joins `context.setCookies`, the members it
 * omits leave the body). Everything below the root reads these wire values. A value that does not
 * fit its node marks a handler bug: it is an internal error, logged once, never an answer without
 * its encoding.
 */
export function encodeOutput(
  context: GraphqlContext,
  action: SurfaceAction,
  value: unknown,
): unknown {
  try {
    const encoded = keepMasked(action.output, value, toWire(action.output, value));
    const hinted = applyCookieHint(
      action.hints.http?.cookie,
      encoded,
      context.session,
      context.carrier.headers ?? {},
      context.now,
    );
    context.setCookies.push(...hinted.setCookies);
    return hinted.value;
  } catch (thrown) {
    throw graphqlErrorOf(
      errors.internal('The output does not fit its field node.', { cause: thrown }),
      context,
    );
  }
}
