import type { StorageRow } from '@keelwerk/core';

/** Owners and probes drawn together, so relation quantifiers have rows to join. */
export interface RandomDataset {
  readonly owners: readonly StorageRow[];
  readonly probes: readonly StorageRow[];
}
