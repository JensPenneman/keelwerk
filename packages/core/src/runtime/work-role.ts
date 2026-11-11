import { capabilitySetsOf } from '../executors/capability-sets-of.ts';
import { actionQueues } from '../worker/action-queues.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/** Four slots for every action queue unless `RuntimeOptions.work` says otherwise. */
const defaultSlots: Readonly<Record<string, number>> = { '*': 4 };

/** The queues the executors of the served apps name, in the order the apps and executors are registered. */
function executorQueues(input: StartPhaseInput): readonly string[] {
  const queues = new Set<string>();
  for (const app of input.apps.values()) {
    for (const executor of app.registry.executors.values()) queues.add(executor.queue);
  }
  return [...queues];
}

/** What a process with the `work` role works (21.1, 21.2). */
export interface WorkRole {
  /** Queue to slots, 0 omitted; '*' gives each action queue and each executor queue not named its own count. */
  readonly slots: ReadonlyMap<string, number>;
  /** Every subset of the process's capabilities as a lane text, `''` first (21.2): action jobs need none, an executor job its own set. */
  readonly capabilitySets: readonly string[];
  /** The build revision the worker takes jobs up to (19.2). */
  readonly revision: number;
}

/**
 * The work a process takes on, from `RuntimeOptions.work` (the named process of the deployment is
 * not selected here: `keelwerk start --process` does not reach the runtime yet) and the build the
 * process runs. `'*'` slots every action queue and every queue an executor of a served app runs
 * in; the capabilities the process advertises are matched against the lanes of effect jobs.
 */
export function workRole(input: StartPhaseInput): WorkRole {
  const declared = input.options.work?.slots ?? defaultSlots;
  const slots = new Map<string, number>();
  for (const queue of [...actionQueues, ...executorQueues(input)]) {
    const count = declared[queue] ?? declared['*'];
    if (count !== undefined && count > 0) slots.set(queue, count);
  }
  for (const [queue, count] of Object.entries(declared)) {
    if (queue !== '*' && count > 0) slots.set(queue, count);
  }
  return {
    slots,
    capabilitySets: capabilitySetsOf(input.options.work?.capabilities ?? []),
    revision: input.connected.build.revision,
  };
}
