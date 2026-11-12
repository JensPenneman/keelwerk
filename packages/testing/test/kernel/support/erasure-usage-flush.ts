import type { Clock } from '@keelwerk/core';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { DumpQuery, PinnedLiveTimers } from '../../../src/index.ts';
import { pinnedLiveTimers } from '../../../src/index.ts';
import { rowsOf } from './erasure-dump-tools.ts';

/** The clock and the timers of a dump test. */
interface DumpTime {
  readonly clock: Clock;
  readonly timers: PinnedLiveTimers;
  /** Moves the clock on by a few milliseconds; it never goes back. */
  advance(ms: number): void;
}

/**
 * A clock that stands still at the start, and timers that never fire on their own: a job that
 * waits for its retry stays waiting however slow the machine is, and the runtime's flush loop
 * of API usage never runs by itself.
 */
function dumpTime(): DumpTime {
  let skew = 0;
  // Frozen at the start: a job that waits for its retry stays waiting however slow the machine is.
  const start = Temporal.Now.instant();
  const clock: Clock = { now: () => start.add({ milliseconds: skew }) };
  return {
    clock,
    timers: pinnedLiveTimers(clock),
    advance: (ms) => {
      skew += ms;
    },
  };
}

/**
 * Makes the runtime write the request counts it buffers into `kw_api_usage` now, with the runtime's
 * own flush and no move of the clock, and answers the rows of the table.
 */
async function flushUsage(
  runtime: { readonly control: TestRuntime<unknown>['control'] },
  queries: readonly DumpQuery[],
): Promise<number> {
  await runtime.control.apiUsage.flush();
  return (await rowsOf(queries, 'kw_api_usage')).length;
}

export type { DumpTime };
export { dumpTime, flushUsage };
