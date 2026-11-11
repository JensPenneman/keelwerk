import type { GraphQLEnumValueConfigMap, GraphQLNamedType } from 'graphql';
import type { GraphqlMember } from './graphql-member.ts';

/**
 * The build's memo of named types and the one place names are checked. A name is built once,
 * whatever number of fields use it; a clash is recorded, never thrown, so that the surface check can
 * report every one of them from the real build.
 */
export interface GraphqlTypeTable {
  /** The entity ref, action ref or error code this view records as the asker of what it builds. */
  readonly subject: string;
  /**
   * The type called `name`; `build` runs on the first request for the name only. `owner` says what
   * the type stands for: a request for a built name from another owner gets the first type back and
   * records a `nameCollision` for every subject involved.
   */
  named<T extends GraphQLNamedType>(name: string, owner: string, build: () => T): T;
  /** A view of the same table that records `subject`; thunks capture it, so a field thunk that runs later still records the right subject. */
  of(subject: string): GraphqlTypeTable;
  /**
   * The members of the type `typeName` as one map. A name taken twice keeps the first entry and
   * records a `nameCollision`; a name that starts with `__` records `reservedName` and one that is no
   * GraphQL name records `unsupportedShape`; both are left out of the map.
   */
  members<T>(typeName: string, entries: readonly GraphqlMember<T>[]): Record<string, T>;
  /**
   * The values of the enum `typeName`: each wire value under `enumValueName`. Two values with one
   * name record `nameCollision`, a name that starts with `__` `reservedName` and a name that is no
   * GraphQL name `unsupportedShape`; the offending values are left out.
   */
  enumValues(typeName: string, values: readonly string[]): GraphQLEnumValueConfigMap;
}
