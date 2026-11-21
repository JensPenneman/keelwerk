import { expect } from 'vitest';
import { steppedClockStepMs } from './stepped-clock-step-ms.ts';
import { steppedClockWait } from './stepped-clock-wait.ts';
import type { TransportBounds } from './transport-bounds.ts';

/** The bounds sit this many longest loops beyond the clock a wait can move: a wait that grows a little is no accident. */
const margin = 10;

/**
 * Fails unless the live socket bounds a runner's host really runs at (read from the host entry it
 * started, not from the text of the runner) sit beyond the longest loop of clock steps of any case
 * (`steppedClockWait` at `steppedClockStepMs` a step) by a `margin` of ten. A runner that sets
 * `steppedClockLiveSocket` passes; one that keeps a default, sets a smaller value, or whose wait has
 * grown past what the constant covers, fails.
 */
export function expectSteppedClockBounds(bounds: TransportBounds): void {
  const mostSteps = steppedClockWait.timeout / steppedClockWait.interval;
  const longestLoopMs = margin * mostSteps * steppedClockStepMs;
  expect(bounds.heartbeatMs, 'heartbeatMs').toBeGreaterThan(longestLoopMs);
  expect(bounds.revalidateMs, 'revalidateMs').toBeGreaterThan(longestLoopMs);
}
