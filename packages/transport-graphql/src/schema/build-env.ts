import type { ApiSurface, SurfaceEntity } from '@keelwerk/core';
import type { FixedTypes } from './fixed-types.ts';
import type { GraphqlTypeTable } from './graphql-type-table.ts';

/** What the parts of one schema build share: the surface, the memo of named types, the fixed types and the sets and sizes the measure reads. */
export interface BuildEnv {
  readonly surface: ApiSurface;
  readonly types: GraphqlTypeTable;
  readonly fixed: FixedTypes;
  readonly entities: ReadonlyMap<string, SurfaceEntity>;
  /** GraphQL object type name to entity ref. */
  readonly entityTypes: Map<string, string>;
  readonly connectionTypes: Set<string>;
  readonly getResultTypes: Set<string>;
  /** The largest page of each connection and get-result type, by type name. */
  readonly pageSizes: Map<string, number>;
}
