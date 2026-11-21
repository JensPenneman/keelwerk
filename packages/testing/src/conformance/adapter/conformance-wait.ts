import type { ConformanceSubject } from './conformance-subject.ts';

/** Moves time on: the target's clock when it has one, real time otherwise. */
export function conformanceWait(
  subject: Pick<ConformanceSubject, 'clock'>,
): (ms: number) => Promise<void> {
  return async (ms) => {
    if (subject.clock === undefined) await new Promise((resolve) => setTimeout(resolve, ms));
    else subject.clock.advance(ms);
  };
}
