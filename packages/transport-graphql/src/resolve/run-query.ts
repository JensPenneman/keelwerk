import type { SurfaceAction } from '@keelwerk/core';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import { encodeOutput } from './encode-output.ts';
import type { GraphqlContext } from './graphql-context.ts';
import { invokeAction } from './invoke-action.ts';

/** Invokes a query and answers its encoded output; a failure is thrown as the GraphQL error of the field. */
export async function runQuery(
  context: GraphqlContext,
  action: SurfaceAction,
  wire: unknown,
): Promise<unknown> {
  const outcome = await invokeAction(context, action, wire);
  if (!outcome.ok) {
    throw graphqlErrorOf(outcome.error, context);
  }
  return encodeOutput(context, action, outcome.value);
}
