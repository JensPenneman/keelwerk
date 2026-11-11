import type { AsyncReactionEvent } from '../dsl/define-reaction.ts';
import { openStoredEvents } from '../encryption/open-stored-events.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { Registry } from '../registry/registry.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { Unit } from '../storage/unit.ts';
import { reactionPayloadOf } from './reaction-payload-of.ts';

/**
 * The event as `react` and `key` see it (7.7): the stored event with its personal values opened (a
 * value whose key is shredded is absent) and `current`, the row of the event's stream read now, in
 * `unit`, by the kernel with `module`'s view of the row (`decodeRow`: no rule and no mask applies;
 * the same view an inline reaction's `state` has). `current` is undefined when the stream is no
 * entity, the row is gone, or the row is erased. The payload is the stored JSON: no upcaster
 * exists yet, so it is not upcast. `data` and `before` hold what `reactionPayloadOf` leaves `module`
 * of them: the same view of an event that `decodeRow` gives of a row.
 */
export async function asyncReactionEventOf(
  unit: Unit,
  registry: Registry,
  module: string,
  stored: StoredEvent,
): Promise<AsyncReactionEvent<string, unknown, Readonly<Record<string, unknown>>>> {
  const [opened] = await openStoredEvents(unit, [stored]);
  const event = opened ?? stored;
  const entry = registry.entities.get(stored.stream.type);
  const row =
    entry === undefined
      ? undefined
      : await unit.rows.findOne(entry.descriptor, {
          where: { op: 'eq', field: 'id', value: stored.stream.id },
          includeArchived: true,
        });
  const payload = reactionPayloadOf(
    entry,
    stored.type.slice(stored.stream.type.length + 1),
    event.data,
    event.before,
    module,
  );
  const erased = row?.kwErasedAt !== undefined && row.kwErasedAt !== null;
  return {
    id: event.eventId,
    type: event.type,
    stream: event.stream,
    version: event.version,
    position: event.position,
    data: payload.data,
    before: payload.before as Partial<Readonly<Record<string, unknown>>> | null,
    actor: event.actor,
    commandId: event.commandId,
    causationId: event.causationId,
    at: event.recordedAt,
    current:
      entry === undefined || row === undefined || erased
        ? undefined
        : decodeRow(entry, row, module),
  };
}
