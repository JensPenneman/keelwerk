import { flushUsage } from '../api-versions/flush-usage.ts';
import { createScheduleTicker } from '../schedules/schedule-ticker.ts';
import { createWorker } from '../worker/create-worker.ts';
import type { RuntimeService } from './runtime-service.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/**
 * The kernel's own runtime services, in start order, one line each: `startRuntimeServices` builds
 * them from the start input and starts them before the event workers of the deployment. Later work
 * packages append theirs here (the schedule ticker, the mark recorder).
 */
export const kernelServices: readonly ((input: StartPhaseInput) => RuntimeService)[] = [
  createWorker,
  () => createScheduleTicker(),
  flushUsage,
];
