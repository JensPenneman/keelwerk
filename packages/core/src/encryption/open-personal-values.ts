import type { StoredEvent } from '../events/stored-event.ts';
import { openKwe } from '../keys/open-kwe.ts';
import { isKweEnvelope } from './is-kwe-envelope.ts';
import type { SealedMembers } from './sealed-members.ts';
import type { SealingContext } from './sealing-context.ts';

const decoder = new TextDecoder();

/** What a value that cannot be opened becomes while members are dropped. */
const absent: unique symbol = Symbol('keelwerk.absent');

async function openIn(
  context: SealingContext,
  event: StoredEvent,
  value: unknown,
  field: string,
  sealed: SealedMembers,
): Promise<unknown> {
  if (isKweEnvelope(value)) {
    const key = await context.keyById(value.k);
    const plain = openKwe(value, key?.material, {
      namespace: context.unit.namespace.id,
      streamId: event.stream.id,
      eventId: event.eventId,
      field,
    });
    // A shredded key, or a value moved to another event or field, stays sealed.
    if (plain !== undefined) return JSON.parse(decoder.decode(plain)) as unknown;
    return sealed === 'drop' ? absent : value;
  }
  if (Array.isArray(value)) {
    const members = await Promise.all(
      value.map((member) => openIn(context, event, member, field, sealed)),
    );
    return members.filter((member) => member !== absent);
  }
  if (typeof value === 'object' && value !== null) {
    const opened: Record<string, unknown> = {};
    for (const [name, member] of Object.entries(value)) {
      const plain = await openIn(context, event, member, name, sealed);
      if (plain !== absent) opened[name] = plain;
    }
    return opened;
  }
  return value;
}

/**
 * An event with the personal values of `data` and `before` opened (14.7.4). A value whose key is
 * shredded, or that was moved to another event or field, stays its sealed envelope under `keep`
 * (a replay compares it so) and is left out under `drop`, where it reads as absent (14.7.9.8). The hash of the stored event covers the
 * sealed form, so chain verification takes events as stored, never through this.
 */
export async function openPersonalValues(
  context: SealingContext,
  event: StoredEvent,
  sealed: SealedMembers,
): Promise<StoredEvent> {
  const data = await openIn(context, event, event.data, '', sealed);
  const before =
    event.before === null
      ? null
      : ((await openIn(context, event, event.before, '', sealed)) as Readonly<
          Record<string, unknown>
        >);
  return { ...event, data, before };
}
