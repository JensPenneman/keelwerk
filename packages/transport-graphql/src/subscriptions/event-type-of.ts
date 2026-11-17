import type { SurfaceAction } from '@keelwerk/core';
import { GraphQLObjectType, GraphQLString, GraphQLUnionType } from 'graphql';
import { actionTypeName } from '../schema/action-type-name.ts';
import type { BuildEnv } from '../schema/build-env.ts';
import { graphqlTypeOf } from '../schema/graphql-type-of.ts';
import { outputFieldsOf } from '../schema/output-fields-of.ts';

/**
 * `<Name>Event`, the union a subscription field answers (section 16.6.5): `<Name>Item`, the members
 * of the event and `state`, the token of the stream after it, and the shared control types
 * `StreamHead`, `StreamReset` and `StreamGap`, so control frames reach a client typed. The members go
 * through the type table, so an event member called `state` is a `nameCollision`.
 */
export function eventTypeOf(env: BuildEnv, action: SurfaceAction): GraphQLUnionType {
  const name = actionTypeName(action);
  const types = env.types.of(action.ref);
  const item = `${name}Item`;
  return types.named(
    `${name}Event`,
    `action ${action.ref}`,
    () =>
      new GraphQLUnionType({
        name: `${name}Event`,
        types: () => [
          types.named(
            item,
            `action ${action.ref}`,
            () =>
              new GraphQLObjectType({
                name: item,
                fields: () =>
                  types.members(item, [
                    ...(action.output.kind === 'shape'
                      ? outputFieldsOf(
                          action.output.fields,
                          item,
                          types,
                          graphqlTypeOf,
                          action.hints.graphql?.enums,
                        )
                      : []),
                    {
                      name: 'state',
                      subject: action.ref,
                      from: "member 'state'",
                      config: {
                        type: GraphQLString,
                        description: 'The state of the stream after this item.',
                      },
                    },
                  ]),
              }),
          ),
          env.fixed.streamHead,
          env.fixed.streamReset,
          env.fixed.streamGap,
        ],
        resolveType: (value: unknown) =>
          typeof value === 'object' && value !== null
            ? String(Reflect.get(value, '__typename'))
            : undefined,
      }),
  );
}
