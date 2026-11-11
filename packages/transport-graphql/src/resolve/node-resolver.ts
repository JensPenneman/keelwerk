import type { GraphQLFieldResolver } from 'graphql';
import type { GraphqlContext } from './graphql-context.ts';
import { nodeById } from './node-by-id.ts';

/** The resolver of `node(id: ID!)` (section 16.6.2). */
export const nodeResolver: GraphQLFieldResolver<unknown, GraphqlContext> = (
  _source,
  args: { readonly id: string },
  context,
) => nodeById(context, args.id);
