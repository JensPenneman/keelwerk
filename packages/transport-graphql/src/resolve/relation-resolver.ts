import type { SurfaceAction } from '@keelwerk/core';
import type { GraphQLFieldResolver } from 'graphql';
import { connectionInput } from './connection-input.ts';
import type { GraphqlContext } from './graphql-context.ts';
import { runQuery } from './run-query.ts';

/**
 * The resolver of a to-many relation (section 16.6.2): one `query` invocation of the target per
 * parent, with the relation's condition (the target's `by` field equals the parent's id) joined
 * to the caller's filter, in wire form. The invoker authorises it as any query, so an invisible
 * row is absent and nothing else leaks.
 */
export function relationResolver(
  by: string,
  query: SurfaceAction,
): GraphQLFieldResolver<Readonly<Record<string, unknown>>, GraphqlContext> {
  return (source, args: Readonly<Record<string, unknown>>, context, info) => {
    const wire = connectionInput(args, info);
    const condition = { [by]: source.id };
    return runQuery(context, query, {
      ...wire,
      filter: wire.filter === undefined ? condition : { and: [wire.filter, condition] },
    });
  };
}
