import type { SurfaceAction } from '@keelwerk/core';
import { type GraphQLFieldConfig, GraphQLNonNull } from 'graphql';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { rootResolver } from '../resolve/root-resolver.ts';
import { actionTypeName } from './action-type-name.ts';
import type { BuildEnv } from './build-env.ts';
import { commandInputOf } from './command-input-of.ts';
import { resultTypeOf } from './result-type-of.ts';

/** The Mutation field of a command (section 16.6.3): one `input` argument, a result union. */
export function mutationFieldOf(
  env: BuildEnv,
  action: SurfaceAction,
): GraphQLFieldConfig<unknown, GraphqlContext> {
  const input = commandInputOf(env, action);
  return {
    type: resultTypeOf(env, action),
    args: { input: { type: input.required ? new GraphQLNonNull(input.type) : input.type } },
    resolve: rootResolver(action, actionTypeName(action)),
  };
}
