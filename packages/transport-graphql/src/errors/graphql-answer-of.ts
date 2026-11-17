import { type DeprecationNotice, errors } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import { type ExecutionResult, GraphQLError } from 'graphql';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { graphqlErrorOf } from './graphql-error-of.ts';

/** What an error raised before any field ran says when the engine's own message could be an internal one (a stack overflow, a coercion defect). */
const variablesDoNotFit = 'The variables do not fit their types.';

function isKeelwerkShaped(error: GraphQLError): boolean {
  return error.extensions !== undefined && Object.hasOwn(error.extensions, 'keelwerk');
}

function mappedError(error: GraphQLError, context: GraphqlContext): GraphQLError {
  if (isKeelwerkShaped(error)) return error;
  const mapped = graphqlErrorOf(
    error.path === undefined
      ? errors.validation(
          error.originalError === undefined || error.originalError instanceof GraphQLError
            ? error.message
            : variablesDoNotFit,
        )
      : asKeelwerkError(error.originalError ?? error),
    context,
  );
  return new GraphQLError(mapped.message, {
    ...(error.nodes === undefined ? {} : { nodes: error.nodes }),
    ...(error.path === undefined ? {} : { path: error.path }),
    extensions: mapped.extensions,
  });
}

/** The notices this answer carries: what the context collected (the session's version notice first, then the action notices of the fields), each one once; the context is emptied, so a later answer of it carries only what came after. */
function noticesOf(context: GraphqlContext): readonly DeprecationNotice[] {
  const seen = new Set<string>();
  return context.notices.splice(0).filter((notice) => {
    const key = JSON.stringify(notice);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One answer of an operation as a caller sees it (sections 16.6.4 and 18.5): every error in the one
 * form of 16.6.4 and, when a deprecated API version or action was used, `extensions.keelwerk.deprecations`.
 * An error a resolver threw already has its form. An error without a path was raised before any field
 * ran (a variable that does not coerce): it is a validation error, with the engine's message when the
 * engine's own error made it and a fixed one when something else did (a stack overflow on a deep
 * value), so no runtime message reaches an answer. Every other error is a failure nothing declared:
 * it is internal, logged once with its cause, and answers the public message with no stack, no cause
 * and no original error. The notices are taken from the context, so a stream carries them on its
 * first result only.
 */
export function graphqlAnswerOf(result: ExecutionResult, context: GraphqlContext): ExecutionResult {
  const mapped =
    result.errors === undefined
      ? result
      : { ...result, errors: result.errors.map((error) => mappedError(error, context)) };
  const notices = noticesOf(context);
  if (notices.length === 0) return mapped;
  const held: unknown = mapped.extensions?.keelwerk;
  return {
    ...mapped,
    extensions: {
      ...mapped.extensions,
      keelwerk: {
        ...(typeof held === 'object' && held !== null ? held : {}),
        deprecations: notices,
      },
    },
  };
}
