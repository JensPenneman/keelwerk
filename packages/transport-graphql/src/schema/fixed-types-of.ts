import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLID,
  GraphQLInt,
  GraphQLInterfaceType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from 'graphql';
import { enumValueName } from './enum-value-name.ts';
import type { FixedTypes } from './fixed-types.ts';

function typenameOf(value: unknown): string | undefined {
  return typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, '__typename') === 'string'
    ? String(Reflect.get(value, '__typename'))
    : undefined;
}

/** A fixed enum whose values take the one name mapping of every enum of the schema (`enumValueName`). */
function enumOf(name: string, values: readonly string[]): GraphQLEnumType {
  return new GraphQLEnumType({
    name,
    values: Object.fromEntries(values.map((value) => [enumValueName(value), { value }])),
  });
}

/** Builds the fixed types: `Node`, `Error`, `PageInfo`, `SortDirection`, `ExecutionPreference`, `CommandAccepted` and the stream types of the subscription root (`StreamHead`, `StreamReset`, `StreamGap`, `StreamResetReason`). */
export function fixedTypesOf(): FixedTypes {
  const node = new GraphQLInterfaceType({
    name: 'Node',
    fields: { id: { type: new GraphQLNonNull(GraphQLID) } },
    resolveType: typenameOf,
  });
  const error = new GraphQLInterfaceType({
    name: 'Error',
    fields: {
      code: { type: new GraphQLNonNull(GraphQLString) },
      message: { type: new GraphQLNonNull(GraphQLString) },
    },
    resolveType: typenameOf,
  });
  const streamResetReason = enumOf('StreamResetReason', ['overflow', 'expired', 'resync']);
  return {
    node,
    error,
    streamResetReason,
    streamHead: new GraphQLObjectType({
      name: 'StreamHead',
      // Nullable like the `state` of an item and of a reset: a client selects `state` on several members of the event union, and GraphQL refuses members whose field differs in nullability.
      fields: { state: { type: GraphQLString } },
    }),
    streamReset: new GraphQLObjectType({
      name: 'StreamReset',
      fields: {
        reason: { type: new GraphQLNonNull(streamResetReason) },
        state: { type: GraphQLString },
      },
    }),
    streamGap: new GraphQLObjectType({
      name: 'StreamGap',
      fields: { missed: { type: GraphQLInt } },
    }),
    pageInfo: new GraphQLObjectType({
      name: 'PageInfo',
      fields: {
        hasNextPage: { type: new GraphQLNonNull(GraphQLBoolean) },
        hasPreviousPage: { type: new GraphQLNonNull(GraphQLBoolean) },
        startCursor: { type: GraphQLString },
        endCursor: { type: GraphQLString },
      },
    }),
    sortDirection: enumOf('SortDirection', ['asc', 'desc']),
    executionPreference: enumOf('ExecutionPreference', ['sync', 'async']),
    commandAccepted: new GraphQLObjectType({
      name: 'CommandAccepted',
      fields: {
        commandId: { type: new GraphQLNonNull(GraphQLString) },
        status: { type: new GraphQLNonNull(GraphQLString) },
      },
    }),
  };
}
