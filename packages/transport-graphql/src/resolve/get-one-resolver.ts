import type { SurfaceAction } from '@keelwerk/core';
import type { GraphQLFieldResolver } from 'graphql';
import type { GraphqlContext } from './graphql-context.ts';
import { runQuery } from './run-query.ts';

/** The resolver of `<entity>(id: ID!)`: the entity's `get` of one id, `null` when absent or invisible (section 16.6.2). */
export function getOneResolver(get: SurfaceAction): GraphQLFieldResolver<unknown, GraphqlContext> {
  return async (_source, args: { readonly id: string }, context) => {
    const answer = await runQuery(context, get, { ids: [args.id] });
    const list =
      typeof answer === 'object' && answer !== null ? Reflect.get(answer, 'list') : undefined;
    return Array.isArray(list) ? (list[0] ?? null) : null;
  };
}
