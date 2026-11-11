import { errors } from '@keelwerk/core';
import type { GraphQLFieldResolver } from 'graphql';
import { graphqlErrorOf } from '../errors/graphql-error-of.ts';
import { nodesBoundOf } from '../schema/nodes-bound-of.ts';
import type { GraphqlContext } from './graphql-context.ts';
import { nodeById } from './node-by-id.ts';

/**
 * The resolver of `nodes(ids: [ID!]!)`: one answer per id, in order (section 16.6.2). The gate
 * already refuses a longer list; this is the backstop that no load runs for a list above the bound.
 */
export const nodesResolver: GraphQLFieldResolver<unknown, GraphqlContext> = (
  _source,
  args: { readonly ids: readonly string[] },
  context,
) => {
  const bound = nodesBoundOf();
  if (args.ids.length > bound) {
    const message = `The field nodes takes at most ${bound} ids; the request sends ${args.ids.length}.`;
    throw graphqlErrorOf(
      errors.validation(message, { issues: [{ path: ['nodes', 'ids'], message }] }),
      context,
    );
  }
  return Promise.all(args.ids.map((id) => nodeById(context, id)));
};
