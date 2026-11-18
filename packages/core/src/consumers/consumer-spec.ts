import type { EventEnvelope } from '../events/event-envelope.ts';
import type { EventSelector } from '../events/event-selector.ts';
import type { StorageScope } from '../storage/storage-scope.ts';
import type { Unit } from '../storage/unit.ts';

/** A kernel consumer of a namespace's event log (section 15.2.3, plus `beforeBatch`). */
export interface ConsumerSpec {
  /** Stable: 'core.reactions', 'reports.stat'. */
  readonly id: string;
  readonly selector: EventSelector;
  /** Projections: beginning; the reaction dispatcher: now for reactions added later. */
  readonly start: 'beginning' | 'now';
  /**
   * Kernel code: one tenant-scope unit together with that scope's checkpoint advance. `prepared`
   * is what `beforeBatch` answered for the batch's scope (absent without a `beforeBatch`, or when
   * `consume` is called directly).
   */
  readonly consume: (
    events: readonly EventEnvelope[],
    unit: Unit,
    prepared?: unknown,
  ) => Promise<void>;
  /**
   * Runs before the unit of a batch opens, with the scope of the batch: work that needs a second
   * unit (such as creating a scope key) cannot run inside `consume` on an adapter that runs one
   * unit at a time. What it answers goes to `consume` of the same batch, so a value derived from a
   * key that the key service caches only for a while is not derived again inside the unit.
   */
  readonly beforeBatch?: (scope: StorageScope) => Promise<unknown>;
  /** Before the stream is parked; default 5. */
  readonly maxAttempts?: number;
}
