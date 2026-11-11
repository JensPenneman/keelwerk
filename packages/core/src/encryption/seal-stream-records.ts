import { errors } from '../errors/errors.ts';
import { sealKwe } from '../keys/seal-kwe.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StreamEntry } from '../registry/stream-entry.ts';
import { streamPersonalMembers } from '../registry/stream-personal-members.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { addSubjectRef } from './add-subject-ref.ts';
import type { SealingContext } from './sealing-context.ts';
import { subjectIdOf } from './subject-id-of.ts';

const encoder = new TextEncoder();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What sealing the records of one append reads. */
export interface SealStreamRecordsInput {
  readonly stream: StreamEntry;
  /** The entity the key references (resolved through `referenceTarget`). */
  readonly keyed: EntityEntry;
  readonly key: string;
  /** Encoded records. */
  readonly records: readonly unknown[];
}

/**
 * Seals each present, non-null top-level member of a record whose field is `.personal()`, or is a
 * list or set of personal elements, under the data key of its subject (14.7.4; the whole member is
 * sealed, under the element's subject): `{ "$kwe": 1, "k", "n", "c" }` with `namespace ‖ stream ‖
 * key ‖ member` as associated data. The subject is read from the keyed row at the field's
 * `subject` path (or its element's), else the entity's data subject, else the row itself. Records one reference per
 * subject to the keyed row's entity stream, so erasure finds it. Records without personal members
 * come back unchanged.
 */
export async function sealStreamRecords(
  context: SealingContext,
  input: SealStreamRecordsInput,
): Promise<readonly unknown[]> {
  const { stream, keyed, key } = input;
  const personal = streamPersonalMembers(stream, keyed.descriptor.dataSubject);
  if (personal.length === 0) return input.records;
  const present = (member: string): boolean =>
    input.records.some(
      (record) => isRecord(record) && record[member] !== undefined && record[member] !== null,
    );
  const used = personal.filter(({ member }) => present(member));
  if (used.length === 0) return input.records;
  const row: StorageRow | undefined = await context.unit.rows.findOne(keyed.descriptor, {
    where: { op: 'eq', field: 'id', value: key },
    includeArchived: true,
  });
  const subjects = new Map<string, string>();
  for (const { member, path } of used) {
    const subject =
      row === undefined ? undefined : await subjectIdOf(context, keyed.descriptor, path, row);
    if (subject === undefined) {
      throw errors.validation(
        `${stream.ref}.${member} is personal and needs its data subject "${path}".`,
        { issues: [{ path: [member], message: `Needs the data subject "${path}".` }] },
      );
    }
    subjects.set(member, subject);
  }
  const sealed = [];
  for (const record of input.records) {
    if (!isRecord(record)) {
      sealed.push(record);
      continue;
    }
    const out: Record<string, unknown> = { ...record };
    for (const { member } of used) {
      const value = record[member];
      const subject = subjects.get(member);
      if (value === undefined || value === null || subject === undefined) continue;
      const dataKey = await context.dataKey(subject);
      out[member] = sealKwe(
        dataKey,
        encoder.encode(JSON.stringify(value)),
        {
          namespace: context.unit.namespace.id,
          streamId: stream.ref,
          eventId: key,
          field: member,
        },
        context.random,
      );
    }
    sealed.push(out);
  }
  for (const subject of new Set(subjects.values())) {
    await addSubjectRef(context, subject, keyed.ref, key);
  }
  return sealed;
}
