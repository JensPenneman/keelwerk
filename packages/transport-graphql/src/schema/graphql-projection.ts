import type { GraphQLSchema } from 'graphql';

/** The GraphQL schema of one surface and what the selection measure needs to know about its types. */
export interface GraphqlProjection {
  readonly schema: GraphQLSchema;
  /** GraphQL object type name to entity ref, for the measure. */
  readonly entityTypes: ReadonlyMap<string, string>;
  /** Names of the `<Type>Connection` types; a field of one counts as a connection page. */
  readonly connectionTypes: ReadonlySet<string>;
  /** Names of the `<Type>GetResult` types; a field of one is read as a page of its ids. */
  readonly getResultTypes: ReadonlySet<string>;
  /** The largest page of a connection or get-result type, by type name: the entity's `page.maxSize`. */
  readonly pageSizes: ReadonlyMap<string, number>;
  /** The most ids `nodes` takes: the smallest page `maxSize` of any entity, never above 100 (the batch of one loader). */
  readonly nodesBound: number;
  /** The most items each list of the introspection types answers, by `Type.field`: what a leaf below such a list is multiplied by in the measure. */
  readonly introspectionSizes: ReadonlyMap<string, number>;
}
