import type { ActionEntry } from '../registry/action-entry.ts';

/** The output as the receipt keeps it: the members shown once are left out. */
export function withoutShownOnce(action: ActionEntry, output: unknown): unknown {
  if (
    action.shownOnce === undefined ||
    typeof output !== 'object' ||
    output === null ||
    Array.isArray(output)
  ) {
    return output;
  }
  const kept: Record<string, unknown> = {};
  for (const [name, member] of Object.entries(output)) {
    if (!action.shownOnce.includes(name)) kept[name] = member;
  }
  return kept;
}
