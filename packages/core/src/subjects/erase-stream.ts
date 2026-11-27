import { personalFieldsOf } from '../encryption/personal-fields-of.ts';
import { buildEventMeta } from '../events/build-event-meta.ts';
import type { ErasedEventData } from '../events/erased-event-data.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import { createValueKeyLifecycle } from '../keys/create-value-key-lifecycle.ts';
import { sealedFieldsOf } from '../keys/sealed-fields-of.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import { moduleServicePrincipal } from '../reactions/module-service-principal.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import { referenceTarget } from '../registry/reference-target.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { appendEvents } from '../write-path/append-events.ts';
import { draftsToEvents } from '../write-path/drafts-to-events.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { writeStateRows } from '../write-path/write-state-rows.ts';
import { handledElsewhere } from './handled-elsewhere.ts';
import { sameSubject } from './same-subject.ts';
import { subjectAt } from './subject-at.ts';

/** What a stream that is left alone reports. */
const untouched = { outcome: 'skipped', owned: false, valueKeys: [] } as const;

/** An erased tombstone: the row's `kwErasedAt` is set (a read sees it only with `includeErased`). */
function isErased(row: StorageRow): boolean {
  return row.kwErasedAt !== undefined && row.kwErasedAt !== null;
}

/** The `erased` event of this subject that is in the stream already (a replay of the step); an event that says owned wins over one that does not. */
async function earlierErasure(
  unit: Unit,
  entry: EntityEntry,
  stream: StreamRef,
  subjectId: string,
): Promise<Partial<ErasedEventData> | undefined> {
  const events = await unit.events.readStream(stream);
  let found: Partial<ErasedEventData> | undefined;
  for (const event of events) {
    if (event.type !== `${entry.ref}.erased`) continue;
    const data = event.data as Partial<ErasedEventData> | null;
    if (data === null || !sameSubject(data.subjectId, subjectId)) continue;
    if (data.owned === true) return data;
    found ??= data;
  }
  return found;
}

/** What erasing one stream did, for the steps that follow. */
export interface EraseStreamResult {
  /**
   * `erased`: this call appended the `erased` event. `replayed`: this erasure's event was in the
   * stream already (an earlier run, or another worker, wrote it), so the stream still counts for
   * the erasure. `skipped`: the stream is not one this erasure erases.
   */
  readonly outcome: 'erased' | 'replayed' | 'skipped';
  /**
   * The row's data subject is the subject (also on a replay, read from the `erased` event the
   * first run wrote): only the principals and commands of owned rows are purged afterwards.
   */
  readonly owned: boolean;
  /** The ids of the value keys destroyed now, which the caller appends to the ledger as tombstones. */
  readonly valueKeys: readonly string[];
}

/** What erasing one stream reads (decision 107: the type lives beside its function). */
export interface EraseStreamInput {
  readonly registry: Registry;
  readonly stream: StreamRef;
  readonly record: ErasureRecord;
  readonly writer: RunJobContext['writer'];
  readonly now: Temporal.Instant;
  /**
   * The erasure found this row as the subject's: the lookup of the owned rows named it, the
   * references of the subject led to it and its data subject was the subject when they did, or a
   * key it holds has a tombstone that this erasure recorded. Only such a row is erased when no
   * subject owns it under its lock any more (its owner was cleared meanwhile); a row found only
   * because it holds a value of the subject is left to whoever owns it, or to nobody, and loses
   * the value. A nominated visit also decides again when this erasure answered the row earlier as
   * a mere holder (not owned) and the row is the subject's now.
   */
  readonly nominated: boolean;
  /**
   * Runs inside the unit with the value keys about to be destroyed, before they are: the caller
   * notes the keys whose tombstone it has not recorded and rolls the unit back before it commits.
   */
  readonly onValueKeys?: (keyIds: readonly string[]) => Promise<void>;
}

/**
 * Steps 3 and 4 of section 14.7.5 for one stream, in the caller's writing tenant unit (a sealing
 * unit): appends an `erased` event (actor: the core's service principal, command id: the erasure's)
 * through the write path (`draftsToEvents`, `writeStateRows`), so the sealed column, its tags and its
 * index rows are cleared like in any update; destroys the value keys of an owned row's secret and
 * verifier fields; and purges the stream records keyed by an owned row. The subject's keys are
 * shredded before this runs, so a value of the subject reads as absent and is cleared with the
 * row. A row reaches this function from the lookup of the owned rows, from the references of the
 * subject and from the key records of the subject, and is decided the same way for each. The outcome is `skipped` when the stream is not a row of an entity that holds the subject's
 * values, the row is gone, or this subject's `erased` event is in the stream already; a replay
 * still reports whether the row is owned, from that event.
 */
export async function eraseStream(unit: Unit, input: EraseStreamInput): Promise<EraseStreamResult> {
  const { registry, stream, record } = input;
  const entry = registry.entities.get(stream.type);
  if (entry === undefined || handledElsewhere.has(entry.ref)) return untouched;
  if (entry.descriptor.tenancy !== 'tenant') return untouched;
  // The row is locked first, and everything that decides what to do is read after the lock: two
  // workers on one erasure queue here, and the second finds the first one's `erased` event (or, for
  // an entity whose records are transient, the row's `kwErasedAt`) and appends nothing.
  const row = await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: stream.id },
    includeArchived: true,
    includeErased: true,
    forUpdate: true,
  });
  if (row === undefined) return untouched;
  const earlier = await earlierErasure(unit, entry, stream, record.subjectId);
  const subject = (path: string) => subjectAt(unit, registry, entry, row, path);
  const { dataSubject } = entry.descriptor;
  const resolved = dataSubject === null ? undefined : await subject(dataSubject);
  // The one answer, read under the row's lock: the subject's, or nobody's when the erasure found
  // the row as the subject's (the owner was cleared since: the row belongs to no living subject).
  // A row of another subject, and a row that nobody owns and that only holds a value, are left alone.
  const owned =
    dataSubject !== null &&
    (sameSubject(resolved, record.subjectId) || (resolved === undefined && input.nominated));
  // An earlier answer of this erasure stands, except that a visit that found the row as the
  // subject's decides again when the earlier answer treated the row as a mere holder (the holder
  // may have been given to the subject since, while her keys were not yet destroyed).
  if (earlier !== undefined && (earlier.owned === true || !input.nominated || !owned)) {
    return { ...untouched, outcome: 'replayed', owned: earlier.owned === true };
  }
  // An erased tombstone with no event of this subject's in its stream (the records of a
  // state-history entity are not kept, or another subject's erasure erased the row) has nothing
  // left to do; it is still reported as the subject's when the lock says so.
  if (isErased(row)) return owned ? { ...untouched, owned } : untouched;
  const fields: string[] = [];
  for (const { name, personal } of personalFieldsOf(entry.descriptor)) {
    if (sameSubject(await subject(personal.subject), record.subjectId)) fields.push(name);
  }
  if (!owned && fields.length === 0) return untouched;
  fields.sort();

  const valueKeys: string[] = [];
  if (owned) {
    const lifecycle = createValueKeyLifecycle(unit);
    // Read under the row's lock, so a secret set meanwhile is among them; the gate sees them all first.
    for (const name of sealedFieldsOf(entry)) {
      const keyId = await lifecycle.keyOf(entry, stream.id, name, false);
      if (keyId !== undefined) valueKeys.push(keyId);
    }
    await input.onValueKeys?.(valueKeys);
    for (const keyId of valueKeys) await lifecycle.destroy(keyId);
    for (const streamEntry of registry.streams.values()) {
      const keyed = referenceTarget(streamEntry.key.ref, streamEntry.module);
      if (keyed !== null && `${keyed.module}.${keyed.entity}` === entry.ref) {
        await unit.streams.purgeKeys(streamEntry.ref, [stream.id]);
      }
    }
  }

  const data: ErasedEventData = { subjectId: record.subjectId, fields, owned };
  const principal = moduleServicePrincipal('core', { scope: { backend: null, tenant: null } });
  const written = await draftsToEvents({
    unit,
    registry,
    behaviours: registryBehaviours(registry),
    drafts: [
      {
        kind: 'event',
        type: 'erased',
        target: entry.ref,
        entity: entry.ref,
        id: stream.id,
        values: data as unknown as Readonly<Record<string, unknown>>,
      },
    ],
    // The module's own authority: the kernel writes its own event, which no module's code can draft.
    authority: entry.module,
    now: input.now,
    meta: () =>
      buildEventMeta({
        principal,
        commandId: record.commandId,
        action: 'core.eraseSubject',
        correlationId: record.commandId,
        build: input.writer.build,
        flags: [],
        decision: null,
      }),
    reads: [],
    // The write path loads and locks the row itself, with the chain columns the event hashes over.
    loaded: new Map(),
    hybridClock: input.writer.hybridClock,
  });
  await appendEvents(unit, written);
  await writeStateRows(unit, written);
  return { outcome: 'erased', owned, valueKeys };
}
