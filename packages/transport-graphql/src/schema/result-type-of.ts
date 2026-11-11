import type { SurfaceAction } from '@keelwerk/core';
import {
  GraphQLNonNull,
  GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLString,
  GraphQLUnionType,
} from 'graphql';
import { actionTypeName } from './action-type-name.ts';
import type { BuildEnv } from './build-env.ts';
import { entityTypeOf } from './entity-type-of.ts';
import { errorTypeOf } from './error-type-of.ts';
import { graphqlTypeOf } from './graphql-type-of.ts';
import type { GraphqlTypeTable } from './graphql-type-table.ts';

/** The type a command's `result` has: the entity for the generated writes of one row, else the derived output type. */
function outputTypeOf(
  env: BuildEnv,
  types: GraphqlTypeTable,
  action: SurfaceAction,
  name: string,
): GraphQLOutputType {
  const entity = action.entity === undefined ? undefined : env.entities.get(action.entity);
  const writes = ['create', 'update', 'archive', 'restore'];
  if (entity !== undefined && action.generated !== undefined && writes.includes(action.generated)) {
    return entityTypeOf(env, entity);
  }
  return graphqlTypeOf(action.output, `${name}Output`, 'output', types) as GraphQLOutputType;
}

/**
 * `<Name>Result`, the union a command answers (section 16.6.3): `<Name>Success` wrapping the
 * output (and the command id, decision D6), one object type per declared error, and
 * `CommandAccepted` when the command may run asynchronously.
 */
export function resultTypeOf(env: BuildEnv, action: SurfaceAction): GraphQLUnionType {
  const name = actionTypeName(action);
  const types = env.types.of(action.ref);
  return types.named(
    `${name}Result`,
    `action ${action.ref}`,
    () =>
      new GraphQLUnionType({
        name: `${name}Result`,
        types: () => {
          const success = types.named(
            `${name}Success`,
            `action ${action.ref}`,
            () =>
              new GraphQLObjectType({
                name: `${name}Success`,
                fields: () =>
                  types.members(`${name}Success`, [
                    {
                      name: 'result',
                      subject: action.ref,
                      from: "member 'result'",
                      config: { type: outputTypeOf(env, types, action, name) },
                    },
                    {
                      name: 'commandId',
                      subject: action.ref,
                      from: "member 'commandId'",
                      config: { type: new GraphQLNonNull(GraphQLString) },
                    },
                  ]),
              }),
          );
          const declared = action.errors.flatMap((code) => {
            const spec = env.surface.errors.find((candidate) => candidate.code === code);
            return spec === undefined ? [] : [errorTypeOf(env, spec)];
          });
          return [
            success,
            ...declared,
            ...(action.execution === 'sync' ? [] : [env.fixed.commandAccepted]),
          ];
        },
        resolveType: (value: unknown) =>
          typeof value === 'object' && value !== null
            ? String(Reflect.get(value, '__typename'))
            : undefined,
      }),
  );
}
