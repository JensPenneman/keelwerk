import { errors } from '../errors/errors.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { DataSubjectHops } from '../write-path/resolve-data-subject-hops.ts';
import { addSubjectRef } from './add-subject-ref.ts';
import type { EventSlot } from './event-slots.ts';
import { eventSlots } from './event-slots.ts';
import type { SealingContext } from './sealing-context.ts';
import { subjectIdOf } from './subject-id-of.ts';

const encoder = new TextEncoder();

function replaced(value: unknown, path: readonly string[], sealed: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return sealed;
  const record = value as Readonly<Record<string, unknown>>;
  return { ...record, [head]: replaced(record[head], rest, sealed) };
}

function valueAt(root: unknown, slot: EventSlot): unknown {
  let current = root;
  for (const segment of slot.path) {
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

/** What sealing one event's personal values reads. */
export interface EncryptPersonalValuesInput {
  readonly entry: EntityEntry;
  readonly streamId: string;
  readonly eventId: string;
  /** The event's local name: `created`, `changed`, a domain event. */
  readonly name: string;
  readonly data: unknown;
  readonly before: Readonly<Record<string, unknown>> | null;
  /** The row after the event: the data subjects are read from it. */
  readonly row: StorageRow;
  /** The rows the deciding command wrote or loaded, read before the store when a data-subject path walks references (S-100). */
  readonly decided?: DataSubjectHops['decided'];
}

/** An event payload with its personal values sealed. */
export interface EncryptedPersonalValues {
  readonly data: unknown;
  readonly before: Readonly<Record<string, unknown>> | null;
}

/**
 * Seals the personal values of an event payload and its before-image (14.7.4): each under its
 * subject's data key as `{ "$kwe": 1, "k", "n", "c" }` with `namespace ‖ stream id ‖ event id ‖
 * field` as associated data, and records the subject's reference to the stream so erasure finds it.
 * The result is what the chain hashes and the store keeps.
 */
export async function encryptPersonalValues(
  context: SealingContext,
  input: EncryptPersonalValuesInput,
): Promise<EncryptedPersonalValues> {
  const slots = eventSlots(input.entry, input.name, input.data, input.before);
  if (slots.length === 0) return { data: input.data, before: input.before };
  let data = input.data;
  let before: unknown = input.before;
  const referenced = new Set<string>();
  for (const slot of slots) {
    const subject = await subjectIdOf(
      context,
      input.entry.descriptor,
      slot.subject,
      input.row,
      input.decided,
    );
    if (subject === undefined) {
      throw errors.validation(
        `${input.entry.ref}.${slot.field} is personal and needs its data subject "${slot.subject}".`,
        { issues: [{ path: [slot.field], message: `Needs the data subject "${slot.subject}".` }] },
      );
    }
    const key = await context.dataKey(subject);
    const original = valueAt(slot.part === 'data' ? data : before, slot);
    const envelope = sealKwe(
      key,
      encoder.encode(JSON.stringify(original)),
      {
        namespace: context.unit.namespace.id,
        streamId: input.streamId,
        eventId: input.eventId,
        field: slot.field,
      },
      context.random,
    );
    if (slot.part === 'data') data = replaced(data, slot.path, envelope);
    else before = replaced(before, slot.path, envelope);
    if (!referenced.has(subject)) {
      referenced.add(subject);
      await addSubjectRef(context, subject, input.entry.ref, input.streamId);
    }
  }
  return { data, before: before as Readonly<Record<string, unknown>> | null };
}
