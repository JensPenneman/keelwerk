import type { EventWorker } from '../events/event-worker.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { ReactionEntry } from './reaction-entry.ts';

/**
 * The boot check `asyncReactionsUnavailable` (S-154): an asynchronous reaction (the default timing)
 * needs the reaction dispatcher, so the deployment must list an event worker that runs
 * `asyncReactions` (`consumers({ ..., runs: ['asyncReactions'] })` of `@keelwerk/events`). One
 * error per reaction when none does.
 */
export function checkAsyncReactions(
  reactions: ReadonlyMap<string, ReactionEntry>,
  workers: readonly Pick<EventWorker, 'runs'>[],
): readonly CompositionProblem[] {
  if (workers.some((worker) => worker.runs.includes('asyncReactions'))) return [];
  return [...reactions.values()]
    .filter((reaction) => reaction.timing === 'async')
    .map((reaction) =>
      compositionError(
        'asyncReactionsUnavailable',
        `The reaction '${reaction.id}' is asynchronous, and no event worker of the deployment runs asyncReactions: list consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }) of @keelwerk/events in the infrastructure.`,
        { module: reaction.module, ref: reaction.id },
      ),
    );
}
