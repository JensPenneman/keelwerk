import type { StartPhaseInput } from './start-phase-input.ts';
import { startRuntimeServices } from './start-runtime-services.ts';

/**
 * The kernel's M2 runtime services, in start order. `startPhase` calls each after M1's start work;
 * an entry starts its work without blocking and answers what stops it within the stop's one deadline.
 * The one entry is the runtime-service seam, which starts `kernelServices` and the event workers.
 */
export const m2Phases: readonly ((
  input: StartPhaseInput,
) => (deadline: AbortSignal) => Promise<void>)[] = [startRuntimeServices];
