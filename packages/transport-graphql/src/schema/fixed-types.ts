import type { GraphQLEnumType, GraphQLInterfaceType, GraphQLObjectType } from 'graphql';

/** The types of every schema that do not depend on the surface (section 16.6.1). */
export interface FixedTypes {
  readonly node: GraphQLInterfaceType;
  readonly error: GraphQLInterfaceType;
  readonly pageInfo: GraphQLObjectType;
  readonly sortDirection: GraphQLEnumType;
  readonly executionPreference: GraphQLEnumType;
  readonly commandAccepted: GraphQLObjectType;
}
