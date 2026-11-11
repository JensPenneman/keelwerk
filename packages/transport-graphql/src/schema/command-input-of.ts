import { pascal, type SurfaceAction } from '@keelwerk/core';
import {
  type GraphQLInputFieldConfig,
  GraphQLInputObjectType,
  GraphQLNonNull,
  GraphQLString,
} from 'graphql';
import { actionTypeName } from './action-type-name.ts';
import type { BuildEnv } from './build-env.ts';
import type { GraphqlMember } from './graphql-member.ts';
import { graphqlTypeOf } from './graphql-type-of.ts';
import type { GraphqlTypeTable } from './graphql-type-table.ts';
import { inputFieldsOf } from './input-fields-of.ts';
import { keelwerkScalars } from './keelwerk-scalars.ts';

type InputMember = GraphqlMember<GraphQLInputFieldConfig>;

/** The input members of a command: its shape, or one `value: JSON!` for a foreign input, or none for a void one. */
function membersOf(
  env: BuildEnv,
  types: GraphqlTypeTable,
  action: SurfaceAction,
  name: string,
): readonly InputMember[] {
  const input = action.input;
  if (input.kind === 'foreign') {
    return [
      {
        name: 'value',
        subject: action.ref,
        from: 'foreign input',
        config: { type: new GraphQLNonNull(keelwerkScalars.JSON) },
      },
    ];
  }
  if (input.kind !== 'shape') return [];
  const entity = action.entity === undefined ? undefined : env.entities.get(action.entity);
  const typeName = entity === undefined ? name : pascal(entity.ref);
  if (action.generated === 'create')
    return inputFieldsOf(input.fields, typeName, types, graphqlTypeOf);
  const { patch, ...rest } = input.fields;
  if (action.generated === 'update' && patch?.kind === 'shape') {
    const fields = inputFieldsOf(rest, name, types, graphqlTypeOf);
    const patchName = `${typeName}Patch`;
    return [
      ...fields,
      {
        name: 'patch',
        subject: action.ref,
        from: "field 'patch'",
        config: {
          type: new GraphQLNonNull(
            types.named(
              patchName,
              `action ${action.ref}`,
              () =>
                new GraphQLInputObjectType({
                  name: patchName,
                  fields: () =>
                    types.members(
                      patchName,
                      inputFieldsOf(patch.fields, typeName, types, graphqlTypeOf),
                    ),
                }),
            ),
          ),
        },
      },
    ];
  }
  return inputFieldsOf(input.fields, name, types, graphqlTypeOf);
}

/**
 * `<Name>Input` of a command (section 16.6.3): the input members, `commandId` and, for an `either`
 * command, `prefer`. `required` says whether the `input` argument must be given: some member is
 * required. The update's `patch` member is the entity's `<Type>Patch`.
 */
export function commandInputOf(
  env: BuildEnv,
  action: SurfaceAction,
): { readonly type: GraphQLInputObjectType; readonly required: boolean } {
  const name = actionTypeName(action);
  const types = env.types.of(action.ref);
  const members = membersOf(env, types, action, name);
  const required = members.some((member) => member.config.type instanceof GraphQLNonNull);
  const type = types.named(
    `${name}Input`,
    `action ${action.ref}`,
    () =>
      new GraphQLInputObjectType({
        name: `${name}Input`,
        fields: () =>
          types.members(`${name}Input`, [
            ...members,
            {
              name: 'commandId',
              subject: action.ref,
              from: "member 'commandId'",
              config: { type: GraphQLString, description: 'The idempotency key of the command.' },
            },
            ...(action.execution === 'either'
              ? [
                  {
                    name: 'prefer',
                    subject: action.ref,
                    from: "member 'prefer'",
                    config: { type: env.fixed.executionPreference },
                  },
                ]
              : []),
          ]),
      }),
  );
  return { type, required };
}
