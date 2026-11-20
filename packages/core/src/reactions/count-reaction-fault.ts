import { metrics } from '@opentelemetry/api';
import type { Meter } from '../observability/meter.ts';

/** The reaction faults that are counted: an event purged, or a process subject or the subject of an observed event erased, before its job ran, a fold of a very long stream, a chain of reactions that reached its depth bound. */
export type ReactionFault = 'event_purged' | 'subject_erased' | 'long_fold' | 'depth_bound';

/**
 * Counts one reaction fault on `keelwerk.reactions.faults`, by kind and reaction id (a reaction id
 * is a module's name, never a value). The meter is the process's unless one is given.
 */
export function countReactionFault(
  fault: ReactionFault,
  reaction: string,
  meter: Meter = metrics.getMeter('keelwerk'),
): void {
  meter
    .createCounter('keelwerk.reactions.faults', {
      description:
        'Reaction jobs that met an event purged or a subject erased before they ran, folds of very long process streams, and reactions not queued because their chain reached its depth bound.',
    })
    .add(1, { fault, reaction });
}
