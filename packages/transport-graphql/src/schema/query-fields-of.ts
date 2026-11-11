import { camel, type SurfaceAction } from '@keelwerk/core';
import {
  type GraphQLFieldConfig,
  GraphQLID,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLNullableOutputType,
  GraphQLObjectType,
  type GraphQLOutputType,
} from 'graphql';
import { getOneResolver } from '../resolve/get-one-resolver.ts';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { rootResolver } from '../resolve/root-resolver.ts';
import { actionArgsOf } from './action-args-of.ts';
import { actionTypeName } from './action-type-name.ts';
import type { BuildEnv } from './build-env.ts';
import { connectionMembersOf } from './connection-members-of.ts';
import { connectionTypeOf } from './connection-type-of.ts';
import { entityTypeOf } from './entity-type-of.ts';
import { getResultTypeOf } from './get-result-type-of.ts';
import type { GraphqlMember } from './graphql-member.ts';
import { graphqlTypeOf } from './graphql-type-of.ts';
import { rootFieldName } from './root-field-name.ts';

/** The page size a custom page output has when its action declares none. */
const defaultPageSize = 100;

/** The connection of a custom page output that no entity stands behind: `<Name>Connection` over `<Name>Item`. */
function pageConnectionOf(env: BuildEnv, action: SurfaceAction, name: string): GraphQLObjectType {
  const connection = `${name}Connection`;
  const types = env.types.of(action.ref);
  env.connectionTypes.add(connection);
  env.pageSizes.set(connection, action.page?.maxSize ?? defaultPageSize);
  return types.named(
    connection,
    `action ${action.ref}`,
    () =>
      new GraphQLObjectType({
        name: connection,
        fields: () =>
          types.members(
            connection,
            connectionMembersOf(
              action.ref,
              new GraphQLNonNull(
                new GraphQLList(
                  new GraphQLNonNull(
                    graphqlTypeOf(
                      action.output.kind === 'page' ? action.output.item : action.output,
                      `${name}Item`,
                      'output',
                      types,
                    ) as GraphQLNullableOutputType,
                  ),
                ),
              ),
              env.fixed.pageInfo,
            ),
          ),
      }),
  );
}

/**
 * The Query fields of a query action (sections 16.6.1 and 16.6.2). A generated `get` has two: the
 * entity by id (`null` when absent or invisible) and the faithful `...Get(ids)`; a page output is a
 * connection; any other output is the derived output type. The caller adds them to the Query type
 * through `members`, so a name two actions take is reported.
 */
export function queryFieldsOf(
  env: BuildEnv,
  action: SurfaceAction,
): readonly GraphqlMember<GraphQLFieldConfig<unknown, GraphqlContext>>[] {
  const name = actionTypeName(action);
  const types = env.types.of(action.ref);
  const entity = action.entity === undefined ? undefined : env.entities.get(action.entity);
  const args = actionArgsOf(env, action);
  const member = (
    field: string,
    from: string,
    config: GraphQLFieldConfig<unknown, GraphqlContext>,
  ): GraphqlMember<GraphQLFieldConfig<unknown, GraphqlContext>> => ({
    name: field,
    subject: action.ref,
    from,
    config,
  });
  if (action.generated === 'get' && entity !== undefined) {
    return [
      member(camel(entity.ref), 'get by id', {
        type: entityTypeOf(env, entity),
        args: { id: { type: new GraphQLNonNull(GraphQLID) } },
        resolve: getOneResolver(action),
      }),
      member(rootFieldName(action), 'root field', {
        type: new GraphQLNonNull(getResultTypeOf(env, entity)),
        args,
        resolve: rootResolver(action, name),
      }),
    ];
  }
  let type: GraphQLOutputType;
  if (action.output.kind === 'page') {
    const connection =
      entity === undefined
        ? pageConnectionOf(env, action, name)
        : connectionTypeOf(env, entity, entityTypeOf(env, entity));
    type = new GraphQLNonNull(connection);
  } else {
    type = graphqlTypeOf(action.output, `${name}Output`, 'output', types) as GraphQLOutputType;
  }
  return [
    member(rootFieldName(action), 'root field', {
      type,
      args,
      resolve: rootResolver(action, name),
    }),
  ];
}
