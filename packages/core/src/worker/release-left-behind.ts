import type { Logger } from '../observability/logger.ts';
import type { HeldJob } from './held-job.ts';
import { releaseAttempts } from './release-attempts.ts';

/** How long a drain waits (wall clock) for aborted handlers before it releases (D4). */
const releaseGraceMs = 1000;

/**
 * Gives the aborted handlers of a drain a short grace to settle (an effect attempt closes its start
 * record, a late commit lands), then releases the attempts left behind and logs what was left.
 */
export async function releaseLeftBehind(input: {
  readonly leftBehind: readonly HeldJob[];
  readonly running: ReadonlySet<Promise<void>>;
  readonly queue: string;
  readonly worker: string;
  readonly log: Logger;
  readonly onError: (error: unknown) => void;
}): Promise<void> {
  const { leftBehind, running, queue, worker, log, onError } = input;
  let grace: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...running]),
      new Promise<void>((resolve) => {
        grace = setTimeout(resolve, releaseGraceMs);
        grace.unref();
      }),
    ]);
  } finally {
    clearTimeout(grace);
  }
  const released = await releaseAttempts(leftBehind, worker, onError);
  log.warn('attempts were still running at the deadline', {
    queue,
    attempts: leftBehind.length,
    released,
    leftToTheirLeases: leftBehind.length - released,
  });
}
