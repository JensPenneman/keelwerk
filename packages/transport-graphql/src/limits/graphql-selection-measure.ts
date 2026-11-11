import type { SelectionMeasure } from '@keelwerk/core';
import type { GraphqlIdList } from './graphql-id-list.ts';

/** The selection measure of section 16.4.12 plus the id lists of the request, which the gate bounds before any row is read. */
export interface GraphqlSelectionMeasure extends SelectionMeasure {
  readonly idLists: readonly GraphqlIdList[];
}
