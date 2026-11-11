import { type KeelwerkError, toWire } from '@keelwerk/core';
import { audienceOf } from '@keelwerk/core/http';
import { GraphQLError } from 'graphql';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { graphqlCodes } from './graphql-codes.ts';

/** A suggestion of a neighbouring name would show a caller what it may not read: the text is cut before it. */
function withoutSuggestion(message: string): string {
  const at = message.indexOf(' Did you mean');
  return at === -1 ? message : message.slice(0, at);
}

/**
 * The GraphQL error of a taxonomy error (section 16.6.4): `extensions.code` of the kind and
 * `extensions.keelwerk` with the wire error of the caller's audience and the request id. An
 * internal error is logged once with its cause; the answer carries neither stack, cause nor
 * original error.
 */
export function graphqlErrorOf(
  error: KeelwerkError,
  context: Pick<GraphqlContext, 'session' | 'development' | 'requestId' | 'log'>,
): GraphQLError {
  if (error.kind === 'internal') {
    context.log.error('The GraphQL request failed.', {
      requestId: context.requestId,
      code: error.code,
      cause: error.cause,
    });
  }
  const wire = toWire(error, audienceOf(context.session, context.development));
  const message = withoutSuggestion(wire.message);
  const keelwerk = {
    ...wire,
    message,
    ...(wire.issues === undefined
      ? {}
      : {
          issues: wire.issues.map((issue) => ({
            ...issue,
            message: withoutSuggestion(issue.message),
          })),
        }),
    requestId: context.requestId,
  };
  return new GraphQLError(message, {
    extensions: { code: graphqlCodes[error.kind], keelwerk },
  });
}
