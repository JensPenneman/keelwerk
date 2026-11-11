import { errors } from '@keelwerk/core';
import { asKeelwerkError } from '@keelwerk/core/http';
import { type ExecutionResult, GraphQLError } from 'graphql';
import type { Plugin } from 'graphql-yoga';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { graphqlErrorOf } from './graphql-error-of.ts';

/** What an error raised before any field ran says when the engine's own message could be an internal one (a stack overflow, a coercion defect). */
const variablesDoNotFit = 'The variables do not fit their types.';

function isKeelwerkShaped(error: GraphQLError): boolean {
  return error.extensions !== undefined && Object.hasOwn(error.extensions, 'keelwerk');
}

function isExecutionResult(value: unknown): value is ExecutionResult {
  return typeof value === 'object' && value !== null && !(Symbol.asyncIterator in value);
}

/**
 * Gives every error of an answer the one form of section 16.6.4. An error a resolver threw already
 * has it. An error without a path was raised before any field ran (a variable that does not
 * coerce): it is a validation error, with the engine's message when the engine's own error made
 * it and a fixed one when something else did (a stack overflow on a deep value), so no runtime
 * message reaches an answer. Every other error is a failure nothing declared: it is
 * internal, logged once with its cause, and answers the public message with no stack, no cause and
 * no original error.
 */
export function keelwerkErrorsPlugin(): Plugin<GraphqlContext> {
  return {
    onExecute() {
      return {
        onExecuteDone({ args, result, setResult }) {
          const context = args.contextValue as GraphqlContext;
          if (!isExecutionResult(result) || result.errors === undefined) return;
          setResult({
            ...result,
            errors: result.errors.map((error) => {
              if (isKeelwerkShaped(error)) return error;
              const mapped = graphqlErrorOf(
                error.path === undefined
                  ? errors.validation(
                      error.originalError === undefined ||
                        error.originalError instanceof GraphQLError
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
            }),
          });
        },
      };
    },
  };
}
