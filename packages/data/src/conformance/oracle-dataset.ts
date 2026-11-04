import type { EntityDescriptor, StorageRow } from '@keelwerk/core';

/** The rows of one scope the oracle evaluates against, by entity ref, with the descriptors of the relation targets. */
export interface OracleDataset {
  rows(ref: string): readonly StorageRow[];
  entity(ref: string): EntityDescriptor;
}
