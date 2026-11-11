import { KeelwerkError } from '@keelwerk/core';
import type { DrainState } from './drain-state.ts';

/**
 * Wakes the workers and settles once they are idle (they run nothing, hold no wake and took no job
 * in their last sweep); answers the attempts they settled since the previous drain of the same
 * runtime, those a commit woke them for included. Throws without workers.
 */
export async function drainJobs(state: DrainState): Promise<number> {
  const { probe } = state;
  if (probe === undefined) {
    throw new KeelwerkError({
      kind: 'internal',
      code: 'core.internal',
      message: 'The test runtime runs no workers: start it with `workers`.',
    });
  }
  probe.wake();
  await probe.idle();
  const before = state.counted;
  state.counted = probe.settled;
  return probe.settled - before;
}
