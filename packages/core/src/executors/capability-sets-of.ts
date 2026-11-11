import { errors } from '../errors/errors.ts';

/** More capabilities than this would make the take match over more than a thousand lane texts. */
const maxCapabilities = 10;

/**
 * Every subset of the process's capabilities as the lane text of the job store (21.2): sorted,
 * distinct, joined by `,`, with the empty set (`''`) first. A job takes only the lane whose text is
 * one of them, so a process that advertises `smtp-out` and `gpu` takes the jobs that need either,
 * both or neither. More than ten distinct capabilities is `unsupported`.
 */
export function capabilitySetsOf(capabilities: readonly string[]): readonly string[] {
  const distinct = [...new Set(capabilities)].sort();
  if (distinct.length > maxCapabilities) {
    throw errors.unsupported(
      `A process advertises at most ${maxCapabilities} capabilities, not ${distinct.length}.`,
    );
  }
  const sets: string[] = [];
  for (let mask = 0; mask < 2 ** distinct.length; mask += 1) {
    sets.push(distinct.filter((_, index) => (mask >> index) & 1).join(','));
  }
  return sets.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a < b ? -1 : a > b ? 1 : 0));
}
