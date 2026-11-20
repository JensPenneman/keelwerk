import { KeelwerkError } from '@keelwerk/core';
import type { DrainState } from './drain-state.ts';

/** The drain of `TestRuntime.drainJobs`, where its guarantee is said. */
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
