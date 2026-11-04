import type { HybridClock } from '../clock/hybrid-clock.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { chainHash } from '../events/chain-hash.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { Hlc } from '../events/hlc.ts';
import type { NewEvent } from '../events/new-event.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { AnyDraft } from '../protocol/any-draft.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import type { Unit } from '../storage/unit.ts';
import { applyDomainEvolve } from './apply-domain-evolve.ts';
import { beforeImage } from './before-image.ts';
import { changedOpsOf } from './changed-ops-of.ts';
import { checkInvariant } from './check-invariant.ts';
import { encodeEventValue } from './encode-event-value.ts';
import type { EntityBehaviours } from './entity-behaviours.ts';
import type { EvolvingEvent } from './evolving-event.ts';
import { genericEvolve } from './generic-evolve.ts';
import { resolveDraftById } from './resolve-draft-by-id.ts';
import { transientRecords } from './transient-records.ts';
import type { WrittenRow } from './written-row.ts';

/** The event schema version generated and domain events are written with (section 15.1.9). */
const schemaVersion = 1;

const systemFields = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'archivedAt',
  'version',
  'kwLastHlc',
  'kwLastHash',
  'kwErasedAt',
]);

function forbidden(message: string, draft: AnyDraft): KeelwerkError {
  return new KeelwerkError({
    kind: 'forbidden',
    code: 'core.forbidden',
    message,
    details: { entity: draft.entity, draft: draft.kind },
  });
}

/** A draft outside the module boundary is `forbidden`, never ignored (section 8.4). */
function assertBoundary(entry: EntityEntry, draft: AnyDraft, authority: string): void {
  if (entry.module === authority) return;
  const fields = Object.keys(draft.values);
  const allContributed =
    fields.length > 0 && fields.every((name) => entry.origin[name] === authority);
  if (draft.kind === 'update' && allContributed) return;
  throw forbidden(
    `"${authority}" may not write ${entry.ref}: a module changes another module's entity only in the fields it contributed.`,
    draft,
  );
}

function missingFields(
  entry: EntityEntry,
  values: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Object.entries(entry.descriptor.fields)
    .filter(
      ([name, field]) => !field.optional && field.kind !== 'serial' && values[name] === undefined,
    )
    .map(([name]) => name);
}

/** The `created` event's values: every field after defaults, `stateOnly` fields apart. */
function createdValues(
  entry: EntityEntry,
  values: Readonly<Record<string, unknown>>,
): { full: Record<string, unknown>; stored: Record<string, unknown> } {
  const full: Record<string, unknown> = {};
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const field = entry.descriptor.fields[name];
    if (field === undefined || systemFields.has(name)) {
      throw errors.validation(`${entry.ref} has no field "${name}"`, {
        issues: [{ path: [name], message: 'Unknown field.' }],
      });
    }
    full[name] = encodeEventValue(value);
    if (!field.stateOnly) stored[name] = full[name];
  }
  return { full, stored };
}

/** What the drafts of a decision are turned into events with. */
export interface DraftsToEventsInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly behaviours: EntityBehaviours;
  readonly drafts: readonly AnyDraft[];
  /** The module whose authority the drafts are written with. */
  readonly authority: string;
  readonly now: Temporal.Instant;
  /**
   * Builds the meta every event carries from the reads the decision recorded. It is called once,
   * after every draft's row is loaded and before any event is hashed, so the decision record the
   * chain covers is the record that is stored.
   */
  readonly meta: (reads: readonly RecordedRead[]) => EventMeta;
  /** The decision's reads so far; a draft by id appends its load here (S-21). */
  readonly reads: RecordedRead[];
  /** Rows the command already holds locked, by `entity/id`: the target of an entity command. */
  readonly loaded: ReadonlyMap<string, StorageRow>;
  /** The process clock the events' readings are taken from (section 14.5.3). */
  readonly hybridClock: HybridClock;
}

/**
 * Steps 5 to 9 of section 15.1.6 for every draft, in order, whichever command returned it: the
 * boundary check, the load and lock of the row (a draft by id loads it, S-21; a draft built from a
 * row must find its version, a create uses expected version 0), the evolve (generic or the
 * author's) with the before-image, the invariant on each post-image, and the event with its
 * clock reading and meta. Several drafts for one row chain: the row is loaded once, its events
 * append with the loaded version as expected version. Nothing is written here; `WrittenRow`s
 * come back for the state update and the append.
 */
export async function draftsToEvents(input: DraftsToEventsInput): Promise<readonly WrittenRow[]> {
  const planned: { readonly draft: AnyDraft; readonly entry: EntityEntry }[] = [];
  const loadedRows = new Map<string, StorageRow>();
  const seen = new Set<string>();
  for (const draft of input.drafts) {
    const entry = input.registry.entities.get(draft.entity);
    if (entry === undefined) {
      throw errors.internal(`a draft names ${draft.entity}, which is not an entity of this app`);
    }
    assertBoundary(entry, draft, input.authority);
    if (entry.descriptor.history === 'projection' || entry.descriptor.history === 'external') {
      throw new KeelwerkError({
        kind: 'not_implemented',
        code: 'core.not_implemented',
        message: `${entry.ref} is a ${entry.descriptor.history} entity, which commands do not write in this release.`,
      });
    }
    planned.push({ draft, entry });
    const key = `${entry.ref}/${draft.id}`;
    if (draft.kind === 'create' || seen.has(key)) {
      seen.add(key);
      continue;
    }
    seen.add(key);
    const held = input.loaded.get(key);
    loadedRows.set(
      key,
      held !== undefined &&
        (draft.expectedVersion === undefined || Number(held.version) === draft.expectedVersion)
        ? held
        : await resolveDraftById({
            unit: input.unit,
            entry,
            id: draft.id,
            reads: input.reads,
            ...(draft.expectedVersion === undefined
              ? {}
              : { expectedVersion: draft.expectedVersion }),
          }),
    );
  }
  const meta = input.meta(input.reads);

  const written = new Map<string, WrittenRow>();
  for (const { draft, entry } of planned) {
    const behaviour = input.behaviours(entry.ref);
    const key = `${entry.ref}/${draft.id}`;
    const recordedAt = input.now;
    let hlc: Hlc;
    const transient = transientRecords(entry);
    let work = written.get(key);
    let name: string;
    let stored: unknown;
    let next: StorageRow;
    let previous: StorageRow | undefined;

    if (draft.kind === 'create') {
      if (work !== undefined) {
        throw new KeelwerkError({
          kind: 'conflict',
          code: 'core.version_mismatch',
          message: `${entry.ref} ${draft.id} is created twice in one command.`,
        });
      }
      if ((draft.expectedVersion ?? 0) !== 0) {
        throw errors.validation('A create starts the stream: its expected version is 0.');
      }
      const values = createdValues(entry, { ...behaviour?.defaults, ...draft.values });
      const missing = missingFields(entry, values.full);
      if (missing.length > 0) {
        throw errors.validation(`${entry.ref} needs ${missing.join(', ')}`, {
          issues: missing.map((field) => ({ path: [field], message: 'Required.' })),
        });
      }
      name = 'created';
      stored = { values: values.stored };
      hlc = input.hybridClock.tick(input.now.epochMilliseconds);
      const evolving: EvolvingEvent = {
        id: draft.id,
        name,
        data: { values: values.full },
        recordedAt,
        hlc,
        hash: null,
      };
      next = genericEvolve(entry, undefined, evolving);
      work = {
        entry,
        id: draft.id,
        created: true,
        loaded: undefined,
        loadedVersion: 0,
        row: next,
        events: [],
        images: [],
      };
      written.set(key, work);
      previous = undefined;
    } else {
      if (work === undefined) {
        const row = loadedRows.get(key);
        if (row === undefined) throw errors.internal(`${key} was not loaded for its draft`);
        work = {
          entry,
          id: draft.id,
          created: false,
          loaded: row,
          loadedVersion: Number(row.version),
          row,
          events: [],
          images: [],
        };
        written.set(key, work);
      }
      previous = work.row;
      const last = previous.kwLastHlc as string | undefined;
      if (last !== undefined && last !== null) input.hybridClock.receive(last as Hlc);
      hlc = input.hybridClock.tick(input.now.epochMilliseconds);
      const base = { id: draft.id, recordedAt, hlc, hash: null } as const;
      switch (draft.kind) {
        case 'update': {
          const ops = changedOpsOf(entry, previous, draft.values);
          name = 'changed';
          stored = ops.stored;
          next = genericEvolve(entry, previous, { ...base, name, data: ops.full });
          break;
        }
        case 'archive': {
          name = 'archived';
          stored = draft.values.reason === undefined ? {} : { reason: draft.values.reason };
          next = genericEvolve(entry, previous, { ...base, name, data: stored });
          break;
        }
        case 'restore':
          name = 'restored';
          stored = {};
          next = genericEvolve(entry, previous, { ...base, name, data: stored });
          break;
        case 'event':
          name = draft.type;
          stored = encodeEventValue(draft.values);
          next = applyDomainEvolve(
            entry,
            behaviour,
            previous,
            { ...base, name, data: stored },
            draft.values,
          );
          break;
      }
    }
    checkInvariant(entry, behaviour, next);
    const eventId = newUuidV7();
    const before = previous === undefined || transient ? null : beforeImage(entry, previous, next);
    const prevHash = transient ? null : ((previous?.kwLastHash as string | undefined) ?? null);
    const hash = transient
      ? null
      : chainHash(prevHash, {
          eventId,
          streamId: draft.id,
          version: Number(next.version),
          name,
          schemaVersion,
          data: stored,
          before,
          hlc,
          recordedAt,
          actor: meta.actor,
          writer: meta.writer,
          flags: meta.flags,
          decision: meta.decision,
          commandId: meta.commandId,
          client: meta.client,
        });
    if (hash !== null) next = { ...next, kwLastHash: hash };
    const event: NewEvent = {
      eventId,
      name,
      schemaVersion,
      shape: entry.descriptor.shape.id,
      data: stored,
      before,
      hlc,
      recordedAt,
      meta,
      transient,
      prevHash,
      hash,
    };
    work.events.push(event);
    work.images.push(next);
    work.row = next;
  }
  return [...written.values()];
}
