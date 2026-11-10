import { eventMarker } from './event-marker.ts';

/** The last step a child reported (`reportStep`), from what it printed on standard error; undefined when it reported none. */
export function lastStepOf(stderr: string): string | undefined {
  const prefix = `${eventMarker} step `;
  const line = stderr.split('\n').findLast((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length);
}
