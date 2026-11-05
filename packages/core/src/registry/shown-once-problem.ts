import type { ActionEntry } from './action-entry.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';

/**
 * A command whose `shownOnce` cannot hold: a name the output shape does not have, or an output
 * that is a row of an entity (its receipt keeps a reference and a replay re-reads the row, so
 * nothing would stay hidden). Returns the problem, or `undefined`.
 */
export function shownOnceProblem(entry: ActionEntry): CompositionProblem | undefined {
  if (entry.shownOnce === undefined || entry.shownOnce.length === 0) return undefined;
  const site = { module: entry.module, ref: entry.ref };
  if (entry.entityOutput?.shape === 'row') {
    return compositionError(
      'shownOnceOnRowOutput',
      `The command '${entry.ref}' answers a row of ${entry.entityOutput.entity}, so its receipt keeps a reference and cannot hide ${entry.shownOnce.join(', ')}; give it an output shape.`,
      site,
    );
  }
  const fields: unknown = Reflect.get(entry.output, 'fields');
  if (
    Reflect.get(entry.output, 'kind') !== 'shape' ||
    typeof fields !== 'object' ||
    fields === null
  ) {
    return undefined;
  }
  const missing = entry.shownOnce.filter((name) => !Object.hasOwn(fields, name));
  if (missing.length === 0) return undefined;
  return compositionError(
    'unknownShownOnce',
    `The command '${entry.ref}' lists ${missing.join(', ')} in shownOnce, which its output does not have.`,
    site,
  );
}
