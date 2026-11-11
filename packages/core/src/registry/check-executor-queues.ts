import { actionQueues } from '../worker/action-queues.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { ExecutorEntry } from './executor-entry.ts';

/**
 * `executorQueueReserved`: an executor's queue may not be named like one of the queues whose jobs
 * are actions the invoker runs (`'commands'`, `'reactions'`, ...). A worker takes those queues as
 * actions, so an effect job parked there would be run as an action and never reach its executor.
 */
export function checkExecutorQueues(
  executors: ReadonlyMap<string, ExecutorEntry>,
): readonly CompositionProblem[] {
  return [...executors.values()]
    .filter((executor) => actionQueues.includes(executor.queue))
    .map((executor) =>
      compositionError(
        'executorQueueReserved',
        `The executor '${executor.ref}' names the queue '${executor.queue}', which runs actions: choose another queue name.`,
        { module: executor.module, ref: executor.ref },
      ),
    );
}
