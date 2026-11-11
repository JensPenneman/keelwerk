import {
  type GraphQLFieldConfig,
  GraphQLNonNull,
  type GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLString,
} from 'graphql';
import type { GraphqlMember } from './graphql-member.ts';
import { keelwerkScalars } from './keelwerk-scalars.ts';

type Page = Readonly<Record<string, unknown>>;

/** The four members every connection has: `nodes` (the page's items), `pageInfo`, `totalCount` (its total) and `queryState`. */
export function connectionMembersOf(
  subject: string,
  nodes: GraphQLOutputType,
  pageInfo: GraphQLObjectType,
): readonly GraphqlMember<GraphQLFieldConfig<unknown, unknown>>[] {
  const member = (
    name: string,
    config: GraphQLFieldConfig<unknown, unknown>,
  ): GraphqlMember<GraphQLFieldConfig<unknown, unknown>> => ({
    name,
    subject,
    from: `member '${name}'`,
    config,
  });
  return [
    member('nodes', { type: nodes, resolve: (page) => (page as Page).items ?? [] }),
    member('pageInfo', { type: new GraphQLNonNull(pageInfo) }),
    member('totalCount', {
      type: keelwerkScalars.SafeInt,
      resolve: (page) => (page as Page).total ?? null,
    }),
    member('queryState', { type: GraphQLString }),
  ];
}
