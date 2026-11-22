import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * The line of a check no source feeds: a note that says plainly that doctor does not check it, with
 * the reason. It is not 'not-checked': that severity is for a check doctor has and could not run.
 */
export function unfedNote(group: string, name: string, reason: string): DoctorFinding {
  return findingOf(group, 'note', name, `doctor does not check this: ${reason}`, 'none needed');
}
