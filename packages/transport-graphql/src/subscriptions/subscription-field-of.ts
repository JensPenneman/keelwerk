import type { SurfaceAction } from '@keelwerk/core';
import { GraphQLError, type GraphQLFieldConfig, GraphQLNonNull, GraphQLString } from 'graphql';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { actionArgsOf } from '../schema/action-args-of.ts';
import { actionTypeName } from '../schema/action-type-name.ts';
import type { BuildEnv } from '../schema/build-env.ts';
import { eventTypeOf } from './event-type-of.ts';
import { subscribeResolver } from './subscribe-resolver.ts';

/** The Subscription field of a subscription action (section 16.6.5): its input members and `after`, answering `<Name>Event!`. */
export function subscriptionFieldOf(
  env: BuildEnv,
  action: SurfaceAction,
): GraphQLFieldConfig<unknown, GraphqlContext> {
  return {
    type: new GraphQLNonNull(eventTypeOf(env, action)),
    args: {
      ...actionArgsOf(env, action),
      after: {
        type: GraphQLString,
        description: 'The state of an item or a head to resume after.',
      },
    },
    subscribe: subscribeResolver(action, `${actionTypeName(action)}Item`),
    // The source ends a failed stream with its error as the last item: it answers as an error result.
    resolve: (frame: unknown) => {
      if (frame instanceof GraphQLError) throw frame;
      return frame;
    },
  };
}
