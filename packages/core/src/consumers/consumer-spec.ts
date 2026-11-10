import type { EventEnvelope } from '../events/event-envelope.ts';
import type { EventSelector } from '../events/event-selector.ts';
import type { Unit } from '../storage/unit.ts';

/** A kernel consumer of a namespace's event log (section 15.2.3, verbatim). */
export interface ConsumerSpec {
  /** Stable: 'core.reactions', 'reports.stat'. */
  readonly id: string;
  readonly selector: EventSelector;
  /** Projections: beginning; the reaction dispatcher: now for reactions added later. */
  readonly start: 'beginning' | 'now';
  /** Kernel code: one tenant-scope unit together with that scope's checkpoint advance. */
  readonly consume: (events: readonly EventEnvelope[], unit: Unit) => Promise<void>;
  /** Before the stream is parked; default 5. */
  readonly maxAttempts?: number;
}
