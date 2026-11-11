import { pascal, type SurfaceEntity } from '@keelwerk/core';
import { GraphQLID, GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLString } from 'graphql';
import type { BuildEnv } from './build-env.ts';
import { entityTypeOf } from './entity-type-of.ts';

/** `<Type>GetResult { list, notFound, state }`: the faithful answer of the generated `get` (section 16.6.2). */
export function getResultTypeOf(env: BuildEnv, entity: SurfaceEntity): GraphQLObjectType {
  const name = `${pascal(entity.ref)}GetResult`;
  const types = env.types.of(entity.ref);
  env.getResultTypes.add(name);
  env.pageSizes.set(name, entity.page.maxSize);
  return types.named(
    name,
    `entity ${entity.ref}`,
    () =>
      new GraphQLObjectType({
        name,
        fields: () => ({
          list: {
            type: new GraphQLNonNull(
              new GraphQLList(new GraphQLNonNull(entityTypeOf(env, entity))),
            ),
          },
          notFound: {
            type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLID))),
          },
          state: { type: GraphQLString },
        }),
      }),
  );
}
