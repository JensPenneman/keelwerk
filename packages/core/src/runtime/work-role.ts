import { actionQueues } from '../worker/action-queues.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/** Four slots for every action queue unless `RuntimeOptions.work` says otherwise. */
const defaultSlots: Readonly<Record<string, number>> = { '*': 4 };

/** What a process with the `work` role works (21.1, 21.2). */
export interface WorkRole {
  /** Queue to slots, 0 omitted; '*' gives each `actionQueues` entry not named its own count. */
  readonly slots: ReadonlyMap<string, number>;
  /** `['']` in M2-1: action jobs need no capability (21.2); effect executors add their sets later. */
  readonly capabilitySets: readonly string[];
  /** The build revision the worker takes jobs up to (19.2). */
  readonly revision: number;
}

/**
 * The work a process takes on, from `RuntimeOptions.work` (the named process of the deployment is
 * not selected here: `keelwerk start --process` does not reach the runtime yet) and the build the
 * process runs.
 */
export function workRole(input: StartPhaseInput): WorkRole {
  const declared = input.options.work?.slots ?? defaultSlots;
  const slots = new Map<string, number>();
  for (const queue of actionQueues) {
    const count = declared[queue] ?? declared['*'];
    if (count !== undefined && count > 0) slots.set(queue, count);
  }
  for (const [queue, count] of Object.entries(declared)) {
    if (queue !== '*' && count > 0) slots.set(queue, count);
  }
  return {
    slots,
    capabilitySets: [''],
    revision: input.connected.build.revision,
  };
}
