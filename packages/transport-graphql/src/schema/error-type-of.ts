import { pascal, type SurfaceError } from '@keelwerk/core';
import { type GraphQLFieldConfig, GraphQLNonNull, GraphQLObjectType, GraphQLString } from 'graphql';
import type { BuildEnv } from './build-env.ts';
import type { GraphqlMember } from './graphql-member.ts';
import { graphqlTypeOf } from './graphql-type-of.ts';
import { outputFieldsOf } from './output-fields-of.ts';

/**
 * The object type of a declared error: `pascal(code)` plus `Error`, implementing `Error`, with its
 * data members as nullable fields (section 16.6.3).
 */
export function errorTypeOf(env: BuildEnv, error: SurfaceError): GraphQLObjectType {
  const name = `${pascal(error.code)}Error`;
  const types = env.types.of(error.code);
  return types.named(
    name,
    `error ${error.code}`,
    () =>
      new GraphQLObjectType({
        name,
        interfaces: [env.fixed.error],
        fields: () => {
          const fixed = (member: string): GraphqlMember<GraphQLFieldConfig<unknown, unknown>> => ({
            name: member,
            subject: error.code,
            from: `member '${member}'`,
            config: { type: new GraphQLNonNull(GraphQLString) },
          });
          return types.members(name, [
            fixed('code'),
            fixed('message'),
            ...(error.data?.kind === 'shape'
              ? outputFieldsOf(error.data.fields, name, types, graphqlTypeOf)
              : []),
          ]);
        },
      }),
  );
}
