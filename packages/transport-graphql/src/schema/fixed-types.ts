import type { GraphQLEnumType, GraphQLInterfaceType, GraphQLObjectType } from 'graphql';

/** The types of every schema that do not depend on the surface (section 16.6.1). */
export interface FixedTypes {
  readonly node: GraphQLInterfaceType;
  readonly error: GraphQLInterfaceType;
  readonly pageInfo: GraphQLObjectType;
  readonly sortDirection: GraphQLEnumType;
  readonly executionPreference: GraphQLEnumType;
  readonly commandAccepted: GraphQLObjectType;
  /** The first frame of a stream: its state. */
  readonly streamHead: GraphQLObjectType;
  /** The frame that ends a stream the client must start again. */
  readonly streamReset: GraphQLObjectType;
  /** The frame that says events were missed. */
  readonly streamGap: GraphQLObjectType;
  readonly streamResetReason: GraphQLEnumType;
}
