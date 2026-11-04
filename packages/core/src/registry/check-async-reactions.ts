import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { ReactionEntry } from './reaction-entry.ts';

/**
 * `asyncReactionsUnavailable` (S-24): M1 runs no worker, so a reaction whose timing is 'async' (the
 * default) is refused; a reaction states `timing: 'inline'`.
 */
export function checkAsyncReactions(
  reactions: ReadonlyMap<string, ReactionEntry>,
): readonly CompositionProblem[] {
  return [...reactions.values()]
    .filter((reaction) => reaction.timing === 'async')
    .map((reaction) =>
      compositionError(
        'asyncReactionsUnavailable',
        `The reaction '${reaction.id}' is asynchronous, and this release runs no worker for it.`,
        { module: reaction.module, ref: reaction.id },
      ),
    );
}
