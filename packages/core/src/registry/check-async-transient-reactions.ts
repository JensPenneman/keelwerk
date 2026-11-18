import { transientRecords } from '../write-path/transient-records.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

/**
 * The compose error `asyncReactionTransient` (7.7, 15.1.10): an asynchronous reaction or process
 * that names an event of a `history: 'state'` entity would never run, because the records of such
 * an entity are transient and the dispatcher skips them. One error per reaction and event. The test
 * is the write path's own predicate (`transientRecords`), so the two cannot drift apart; `on: 'all'`
 * is not refused.
 */
export function checkAsyncTransientReactions(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const reaction of registry.reactions.values()) {
    if (reaction.timing !== 'async' || reaction.on === 'all') continue;
    for (const event of reaction.on) {
      const entity = event.slice(0, Math.max(0, event.lastIndexOf('.')));
      const entry = registry.entities.get(entity);
      if (entry === undefined || !transientRecords(entry)) continue;
      problems.push(
        compositionError(
          'asyncReactionTransient',
          `The reaction '${reaction.id}' is asynchronous and reacts to '${event}', a record of the history: 'state' entity '${entity}': such records are transient and reach inline reactions only.`,
          { module: reaction.module, ref: reaction.id },
        ),
      );
    }
  }
  return problems;
}
