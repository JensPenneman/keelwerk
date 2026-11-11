import { errors } from '../errors/errors.ts';
import { personalFlagOf } from '../fields/personal-flag-of.ts';
import type { Shape } from '../fields/shape.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import { addSubjectRef } from './add-subject-ref.ts';
import { isSubjectUuid } from './is-subject-uuid.ts';
import type { SealingContext } from './sealing-context.ts';

const encoder = new TextEncoder();

/** What sealing one event of a process's stream reads. */
export interface SealProcessEventInput {
  /** The process id: the type of the stream. */
  readonly ref: string;
  /** The event's declared shape. */
  readonly shape: Shape;
  readonly streamId: string;
  readonly eventId: string;
  /** The instance's data subject: the instance key (Q2). */
  readonly subject: string;
  /** The encoded payload. */
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Seals each present, non-null member of a process event that is personal, or holds a personal
 * list or set element, under the data key of the instance's subject (14.7.4, S-124): `{ "$kwe": 1,
 * "k", "n", "c" }` with `namespace ‖ stream id ‖ event id ‖ member` as associated data, the whole
 * member as JSON. Records the subject's reference to the process stream once, so erasure finds it.
 * An event without personal members comes back unchanged. The subject is the instance key: a
 * process that holds personal members declares `dataSubject: 'instanceKey'` (checked at compose),
 * and its instance keys are the ids of the subjects, lower-case UUIDs (`validation` otherwise).
 */
export async function sealProcessEvent(
  context: SealingContext,
  input: SealProcessEventInput,
): Promise<Readonly<Record<string, unknown>>> {
  const out: Record<string, unknown> = { ...input.data };
  let sealed = false;
  for (const [member, def] of Object.entries(input.shape.fields)) {
    if (personalFlagOf(def) === false) continue;
    const value = input.data[member];
    if (value === undefined || value === null) continue;
    if (!isSubjectUuid(input.subject)) {
      throw errors.validation(
        `${input.ref}.${member} is personal: the instance key of the process is its data subject and must be the id of that subject (a lower-case UUID).`,
      );
    }
    const key = await context.dataKey(input.subject);
    out[member] = sealKwe(
      key,
      encoder.encode(JSON.stringify(value)),
      {
        namespace: context.unit.namespace.id,
        streamId: input.streamId,
        eventId: input.eventId,
        field: member,
      },
      context.random,
    );
    sealed = true;
  }
  if (sealed) await addSubjectRef(context, input.subject, input.ref, input.streamId);
  return out;
}
