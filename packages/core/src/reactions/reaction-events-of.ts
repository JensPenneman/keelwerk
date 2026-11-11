import type { InlineReactionEvent } from '../dsl/define-reaction.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { WrittenRow } from '../write-path/written-row.ts';

/**
 * The events a decision wrote, as the reactions of `module` see them, in the order they were
 * written: per row, its events in version order. `state` is the row right after that event,
 * read under the module's authority.
 */
export function reactionEventsOf(
  written: readonly WrittenRow[],
  module: string,
): readonly InlineReactionEvent<string, unknown, Readonly<Record<string, unknown>>>[] {
  return written.flatMap((item) => {
    return item.events.map((event, index) => ({
      id: event.eventId,
      type: `${item.entry.ref}.${event.name}`,
      stream: { type: item.entry.ref, id: item.id },
      version: item.loadedVersion + index + 1,
      position: null,
      data: item.opened[index]?.data ?? event.data,
      before: (item.opened[index]?.before ?? event.before) as Partial<
        Readonly<Record<string, unknown>>
      > | null,
      actor: event.meta.actor,
      commandId: event.meta.commandId,
      causationId: event.meta.causationId,
      at: event.recordedAt,
      state: decodeRow(item.entry, item.images[index] ?? item.row, module),
    }));
  });
}
