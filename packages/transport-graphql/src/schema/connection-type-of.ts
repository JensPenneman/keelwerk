import { pascal, type SurfaceEntity } from '@keelwerk/core';
import { GraphQLList, GraphQLNonNull, GraphQLObjectType } from 'graphql';
import type { BuildEnv } from './build-env.ts';
import { connectionMembersOf } from './connection-members-of.ts';

/**
 * `<Type>Connection { nodes, pageInfo, totalCount, queryState }` (section 16.6.1, decision D2: no
 * `edges`, the kernel's page has no cursor per row). The fields read the encoded page: `nodes` its
 * `items`, `totalCount` its `total`. The caller passes the entity's object type, which itself
 * builds connections for its relations.
 */
export function connectionTypeOf(
  env: BuildEnv,
  entity: SurfaceEntity,
  entityType: GraphQLObjectType,
): GraphQLObjectType {
  const name = `${pascal(entity.ref)}Connection`;
  const types = env.types.of(entity.ref);
  env.connectionTypes.add(name);
  env.pageSizes.set(name, entity.page.maxSize);
  return types.named(
    name,
    `entity ${entity.ref}`,
    () =>
      new GraphQLObjectType({
        name,
        fields: () =>
          types.members(
            name,
            connectionMembersOf(
              entity.ref,
              new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(entityType))),
              env.fixed.pageInfo,
            ),
          ),
      }),
  );
}
