import type { Position, QueueSource } from '@keelwerk/core';

/** Moved scopes read per page. */
const page = 500;

/**
 * The scopes of the source's namespace whose head is beyond what is known of them (section 15.2.3):
 * every page of `movedScopes` in read-only namespace units, ordered by scope id.
 */
export async function movedScopesOf(
  source: QueueSource,
  known: ReadonlyMap<string, Position>,
): Promise<readonly { readonly scopeId: string; readonly head: Position }[]> {
  const marks = new Map(known);
  const moved: { readonly scopeId: string; readonly head: Position }[] = [];
  for (;;) {
    const found = await source.handle.adapter.unit(
      source.namespace,
      { level: 'namespace', reason: 'consumer sweep' },
      (unit) => unit.events.movedScopes(marks, page),
      { readOnly: true },
    );
    for (const entry of found) {
      moved.push(entry);
      marks.set(entry.scopeId, entry.head);
    }
    if (found.length < page) return moved;
  }
}
