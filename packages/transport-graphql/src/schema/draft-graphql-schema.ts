import type { ApiSurface } from '@keelwerk/core';
import {
  GraphQLBoolean,
  type GraphQLFieldConfig,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  type GraphQLNamedType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isUnionType,
} from 'graphql';
import type { GraphqlContext } from '../resolve/graphql-context.ts';
import { nodeResolver } from '../resolve/node-resolver.ts';
import { nodesResolver } from '../resolve/nodes-resolver.ts';
import type { BuildEnv } from './build-env.ts';
import { entityTypeOf } from './entity-type-of.ts';
import { fixedTypesOf } from './fixed-types-of.ts';
import { fixedTypesSubject } from './fixed-types-subject.ts';
import type { GraphqlMember } from './graphql-member.ts';
import type { GraphqlSchemaDraft } from './graphql-schema-draft.ts';
import { introspectionSizesOf } from './introspection-sizes-of.ts';
import { isProjected } from './is-projected.ts';
import { keelwerkScalars } from './keelwerk-scalars.ts';
import { mutationFieldOf } from './mutation-field-of.ts';
import { nodesBoundOf } from './nodes-bound-of.ts';
import { queryFieldsOf } from './query-fields-of.ts';
import { rootFieldName } from './root-field-name.ts';
import { typeTableOf } from './type-table-of.ts';

type RootField = GraphqlMember<GraphQLFieldConfig<unknown, GraphqlContext>>;

/** Resolves the fields, arguments and values of every type the table built or a second identity would have built, until none is new: the build of a loser is where its own nested clashes are found. */
function resolveThunks(types: ReturnType<typeof typeTableOf>): void {
  const resolved = new Set<GraphQLNamedType>();
  const pending = (): GraphQLNamedType[] =>
    [...types.all(), ...types.losers()].filter((type) => !resolved.has(type));
  for (let next = pending(); next.length > 0; next = pending()) {
    for (const type of next) {
      resolved.add(type);
      if (isObjectType(type) || isInterfaceType(type)) {
        type.getFields();
        type.getInterfaces();
      } else if (isInputObjectType(type)) type.getFields();
      else if (isUnionType(type)) type.getTypes();
      else if (isEnumType(type)) type.getValues();
    }
  }
}

/**
 * Builds the GraphQL schema of a surface and reports what the build met: an object type per
 * entity, a root field per query and command, `node` and `nodes`, and the fixed types (section
 * 16.6.1). It never throws for a name that clashes: the clash is a problem of the draft. Pure: the
 * same surface gives the same schema. `new GraphQLSchema` resolves every field, argument and enum
 * thunk of the types the schema reaches and `resolveThunks` those of the types a second identity
 * built, so the problems are complete once it returns. `inspectGraphqlSurface` runs it after the
 * cheaper checks and `buildGraphqlSchema` serves it.
 */
export function draftGraphqlSchema(surface: ApiSurface): GraphqlSchemaDraft {
  const types = typeTableOf();
  const fixed = fixedTypesOf();
  const env: BuildEnv = {
    surface,
    types,
    fixed,
    entities: new Map(surface.entities.map((entity) => [entity.ref, entity])),
    entityTypes: new Map(),
    connectionTypes: new Set(),
    getResultTypes: new Set(),
    pageSizes: new Map(),
  };
  const projected = surface.actions.filter(isProjected);
  const queryFields: RootField[] = [
    {
      name: 'node',
      subject: 'Query',
      from: 'the node lookup',
      config: {
        type: fixed.node,
        args: { id: { type: new GraphQLNonNull(GraphQLID) } },
        resolve: nodeResolver,
      },
    },
    {
      name: 'nodes',
      subject: 'Query',
      from: 'the nodes lookup',
      config: {
        type: new GraphQLNonNull(new GraphQLList(fixed.node)),
        args: { ids: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLID))) } },
        resolve: nodesResolver,
      },
    },
  ];
  const mutationFields: RootField[] = [];
  const query = new GraphQLObjectType({
    name: 'Query',
    fields: () => types.members('Query', queryFields),
  });
  const mutation = projected.some((action) => action.kind !== 'query')
    ? new GraphQLObjectType({
        name: 'Mutation',
        fields: () => types.members('Mutation', mutationFields),
      })
    : undefined;
  // The fixed types take their names first, so a derived type that wants one is a collision.
  const fixedTypes: readonly GraphQLNamedType[] = [
    query,
    ...(mutation === undefined ? [] : [mutation]),
    fixed.node,
    fixed.error,
    fixed.pageInfo,
    fixed.sortDirection,
    fixed.executionPreference,
    fixed.commandAccepted,
    GraphQLString,
    GraphQLInt,
    GraphQLFloat,
    GraphQLBoolean,
    GraphQLID,
    ...Object.values(keelwerkScalars),
  ];
  for (const type of fixedTypes) types.of(fixedTypesSubject).named(type.name, 'fixed', () => type);
  for (const entity of surface.entities) entityTypeOf(env, entity);
  for (const action of projected) {
    if (action.kind === 'query') {
      queryFields.push(...queryFieldsOf(env, action));
    } else {
      mutationFields.push({
        name: rootFieldName(action),
        subject: action.ref,
        from: 'root field',
        config: mutationFieldOf(env, action),
      });
    }
  }
  const schema = new GraphQLSchema({
    query,
    ...(mutation === undefined ? {} : { mutation }),
    types: types.all(),
  });
  resolveThunks(types);
  return {
    projection: {
      schema,
      entityTypes: env.entityTypes,
      connectionTypes: env.connectionTypes,
      getResultTypes: env.getResultTypes,
      pageSizes: env.pageSizes,
      nodesBound: nodesBoundOf(),
      introspectionSizes: introspectionSizesOf(schema),
    },
    problems: types.problems(),
  };
}
