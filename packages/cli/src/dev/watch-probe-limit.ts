import { eventMarker } from './event-marker.ts';

/** Which stall limit applies to the probe, decided from the events it printed. */
export interface ProbeLimitWatch {
  /** The limit before the first event: nothing is imported yet, so the probe's own work counts. */
  readonly startMs: number;
  /** Takes in one event line and returns the limit that fits what the child is doing after it. */
  after(line: string): number;
  /** Whether at least one project module import is in flight: an `import` event without its `done`. */
  importing(): boolean;
}

/**
 * Chooses the stall limit at every event: `importMs` while a project module import is in flight,
 * `stepMs` while none is. A module that was finished earlier and is imported again is not in
 * flight, because the runtime does not evaluate it a second time and so never reports it again.
 */
export function watchProbeLimit(importMs: number, stepMs: number): ProbeLimitWatch {
  const pending = new Set<string>();
  const finished = new Set<string>();
  return {
    startMs: stepMs,
    after: (line) => {
      const [kind, first, second] = line.slice(eventMarker.length + 1).split(' ');
      // The probe is sequential and reports a step only after an await returned or threw, so nothing
      // imported before a step can still be in flight; an import that failed never reports `done`.
      if (kind === 'step') pending.clear();
      if (kind === 'import' && second !== undefined && !finished.has(second)) pending.add(second);
      if (kind === 'done' && first !== undefined) {
        finished.add(first);
        pending.delete(first);
      }
      return pending.size > 0 ? importMs : stepMs;
    },
    importing: () => pending.size > 0,
  };
}
