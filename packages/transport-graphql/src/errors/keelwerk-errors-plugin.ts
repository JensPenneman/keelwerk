import type { ExecutionResult } from 'graphql';
import { handleStreamOrSingleExecutionResult, type Plugin } from 'graphql-yoga';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { graphqlAnswerOf } from './graphql-answer-of.ts';

function isExecutionResult(value: unknown): value is ExecutionResult {
  return typeof value === 'object' && value !== null && !(Symbol.asyncIterator in value);
}

/**
 * Gives every answer of an operation, a query, a mutation or each result of a subscription, the
 * form of section 16.6.4 and the notices of 18.5 (`graphqlAnswerOf`).
 */
export function keelwerkErrorsPlugin(): Plugin<GraphqlContext> {
  return {
    onExecute() {
      return {
        onExecuteDone({ args, result, setResult }) {
          const context = args.contextValue as GraphqlContext;
          if (!isExecutionResult(result)) return;
          setResult(graphqlAnswerOf(result, context));
        },
      };
    },
    onSubscribe({ args }) {
      const context = args.contextValue as GraphqlContext;
      return {
        onSubscribeResult(payload) {
          // A stream answers its `onNext` hook, which sees each result in turn.
          return handleStreamOrSingleExecutionResult(payload, ({ result, setResult }) => {
            setResult(graphqlAnswerOf(result, context));
          });
        },
      };
    },
  };
}
