import { pascal, type SurfaceAction } from '@keelwerk/core';
import {
  type GraphQLArgumentConfig,
  type GraphQLFieldConfigArgumentMap,
  type GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLNullableInputType,
  GraphQLString,
} from 'graphql';
import { actionTypeName } from './action-type-name.ts';
import type { BuildEnv } from './build-env.ts';
import { filterInputOf } from './filter-input-of.ts';
import type { GraphqlMember } from './graphql-member.ts';
import { graphqlTypeOf } from './graphql-type-of.ts';
import { isGraphqlName } from './is-graphql-name.ts';
import { keelwerkScalars } from './keelwerk-scalars.ts';
import { sortInputOf } from './sort-input-of.ts';

/**
 * The arguments of a query field (section 16.6.2): the input members of the action, with the
 * generated queries' `filter` and `sort` typed from their entity and `first` and `last` as `Int`;
 * `properties` is never an argument (decision D5) and `total` is set from the selection of
 * `totalCount`. A foreign input is one `input: JSON` argument and a void input has none.
 */
export function actionArgsOf(env: BuildEnv, action: SurfaceAction): GraphQLFieldConfigArgumentMap {
  const input = action.input;
  const types = env.types.of(action.ref);
  if (input.kind === 'foreign') return { input: { type: keelwerkScalars.JSON } };
  if (input.kind !== 'shape') return {};
  const entity = action.entity === undefined ? undefined : env.entities.get(action.entity);
  const listing = action.generated === 'query' || action.generated === 'queryChanges';
  const name = actionTypeName(action);
  const args: GraphqlMember<GraphQLArgumentConfig>[] = [];
  for (const [member, node] of Object.entries(input.fields)) {
    if (node.access === 'read' || node.kind === 'void') continue;
    if (action.generated !== undefined && member === 'properties') continue;
    if (action.generated === 'query' && member === 'total') continue;
    let type: GraphQLInputType;
    if (listing && entity !== undefined && member === 'filter') {
      type = filterInputOf(entity, env.surface, types);
    } else if (listing && entity !== undefined && member === 'sort') {
      const sort = sortInputOf(env, entity);
      if (sort === undefined) continue;
      type = new GraphQLList(new GraphQLNonNull(sort));
    } else if (listing && (member === 'first' || member === 'last')) {
      type = GraphQLInt;
    } else {
      type = (
        isGraphqlName(member)
          ? graphqlTypeOf(node, `${name}${pascal(member)}`, 'input', types)
          : GraphQLString
      ) as GraphQLNullableInputType;
    }
    const required = !node.optional && node.default === undefined;
    args.push({
      name: member,
      subject: action.ref,
      from: `argument '${member}'`,
      config: {
        type: required ? new GraphQLNonNull(type as GraphQLNullableInputType) : type,
        ...(node.description === undefined ? {} : { description: node.description }),
      },
    });
  }
  return types.members(`the arguments of ${action.ref}`, args);
}
