import { usageFailure } from '../context/usage-failure.ts';
import type { MigrationTarget } from '../producers/migration-target.ts';

/** The target of a track id; an unknown one is a usage mistake that lists the tracks the workspace holds. */
export function targetOfTrack(targets: readonly MigrationTarget[], track: string): MigrationTarget {
  const found = targets.find((target) => target.track === track);
  if (found === undefined) {
    throw usageFailure(
      `The workspace has no migration track "${track}". Tracks: ${targets.map((target) => target.track).join(', ') || 'none'}.`,
    );
  }
  return found;
}
