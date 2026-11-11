import type { ActionEntry } from '../registry/action-entry.ts';
import { entityPositions } from './entity-positions.ts';
import { isMemberRecord } from './is-member-record.ts';
import { reachAt } from './reach-at.ts';
import { rewritePositions } from './rewrite-positions.ts';

const always: ReadonlySet<string> = new Set(['id', 'version', '$masked']);

/**
 * The answer limited to what the caller selected, in the names of the caller's version: a row keeps
 * `id`, `version`, `$masked` and the selected names (section 16.4.5). `input` is the caller's input
 * as the version knows it; an action or an input without a selection returns the answer as it is.
 */
export function narrowToSelection(action: ActionEntry, input: unknown, answer: unknown): unknown {
  const positions = entityPositions(action);
  if (positions === undefined) return answer;
  const selected = new Set<string>();
  let selects = false;
  for (const path of positions.selections) {
    for (const { value } of reachAt(input, path)) {
      if (!Array.isArray(value)) continue;
      selects = true;
      for (const name of value as readonly unknown[])
        if (typeof name === 'string') selected.add(name);
    }
  }
  if (!selects) return answer;
  let next = answer;
  for (const path of positions.outputRows) {
    next = rewritePositions(next, path, (row) =>
      isMemberRecord(row)
        ? Object.fromEntries(
            Object.entries(row).filter(([name]) => always.has(name) || selected.has(name)),
          )
        : row,
    );
  }
  return next;
}
