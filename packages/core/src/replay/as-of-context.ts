import type { Registry } from '../registry/registry.ts';
import type { EntityBehaviours } from '../write-path/entity-behaviours.ts';
import type { AsOfReads } from './as-of-reads.ts';

/** What the as-of units of one re-decide share. */
export interface AsOfContext {
  readonly registry: Registry;
  readonly behaviours: EntityBehaviours;
  readonly reads: AsOfReads;
}
