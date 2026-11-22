import type { DoctorFinding } from '../../doctor/doctor-finding.ts';
import { findingOf } from '../../doctor/finding-of.ts';

/** The connection flags doctor accepts and does not use. */
const ignoredFlags = ['profile', 'backend', 'tenant', 'socket'] as const;

/** One note for each of the connection flags that was given: it has no effect on doctor yet. */
export function ignoredFlagNotes(
  parsed: Readonly<Record<string, unknown>>,
): readonly DoctorFinding[] {
  return ignoredFlags
    .filter((flag) => parsed[flag] !== undefined)
    .map((flag) =>
      findingOf(
        'doctor',
        'note',
        `--${flag}`,
        `--${flag} has no effect on doctor yet`,
        `leave out --${flag}; doctor reads the deployment file and the environment`,
      ),
    );
}
