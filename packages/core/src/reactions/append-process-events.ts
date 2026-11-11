import type { HybridClock } from '../clock/hybrid-clock.ts';
import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import { errors } from '../errors/errors.ts';
import { chainHash } from '../events/chain-hash.ts';
import type { EventMeta } from '../events/event-meta.ts';
import type { NewEvent } from '../events/new-event.ts';
import { personalFlagOf } from '../fields/personal-flag-of.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import type { FoldedProcess } from './fold-process-state.ts';
import { processShapeId } from './process-shape-id.ts';

/** The event schema version process events are written with. */
const schemaVersion = 1;

/** What the events a decision holds for a process's stream are appended with. */
export interface AppendProcessEventsInput {
  readonly unit: Unit;
  readonly reaction: ReactionEntry;
  readonly folded: FoldedProcess;
  /** The decision's event drafts whose `entity` is the process id, in order. */
  readonly drafts: readonly EventDraft[];
  readonly meta: EventMeta;
  readonly hybridClock: HybridClock;
  readonly now: Temporal.Instant;
}

/**
 * Validates, encodes, seals, chains and appends the events a process's decision holds for its
 * stream (S-124), at the version the stream had when it was folded; answers their ids. Each event
 * is chained like an entity event: `prevHash` is the previous event's hash (the stream's last for
 * the first), and the hash covers the sealed payload, so the chain verifies from the stored
 * records. `validation` for a name the process does not declare and for a payload its shape
 * refuses; `conflict` `core.version_mismatch` when the stream moved since it was folded; `internal`
 * when the unit cannot seal a personal member (the runtime's units always can).
 */
export async function appendProcessEvents(
  input: AppendProcessEventsInput,
): Promise<readonly string[]> {
  const { unit, reaction, folded, meta } = input;
  const sealer = personalSealerOf(unit);
  const events: NewEvent[] = [];
  const shape = processShapeId(reaction.id);
  let prevHash = folded.lastHash;
  let version = folded.version;
  for (const draft of input.drafts) {
    const declared = reaction.eventShapes?.[draft.type];
    if (declared === undefined || !(reaction.events ?? []).includes(draft.type)) {
      throw errors.validation(
        `The process "${reaction.id}" does not declare the event "${draft.type}".`,
      );
    }
    const checked = await declared['~standard'].validate(draft.values);
    if (checked.issues !== undefined) {
      throw errors.validation(
        `The event "${draft.type}" of the process "${reaction.id}" does not match its shape.`,
        {
          issues: checked.issues.map((issue) => ({
            path: (issue.path ?? []).map(String),
            message: issue.message,
          })),
        },
      );
    }
    const encoded = encodeEventValue(checked.value) as Readonly<Record<string, unknown>>;
    const eventId = newUuidV7();
    version += 1;
    const holdsPersonal = Object.values(declared.fields).some(
      (def) => personalFlagOf(def) !== false,
    );
    if (holdsPersonal && sealer === undefined) {
      throw errors.internal(`the unit cannot seal the personal members of "${reaction.id}"`);
    }
    if (holdsPersonal && folded.subject === undefined) {
      throw errors.internal(
        `the process "${reaction.id}" holds personal members and has no subject`,
      );
    }
    const data =
      sealer === undefined
        ? encoded
        : await sealer.sealProcessEvent({
            ref: reaction.id,
            shape: declared,
            streamId: folded.stream.id,
            eventId,
            subject: folded.subject ?? '',
            data: encoded,
          });
    const hlc = input.hybridClock.tick(input.now.epochMilliseconds);
    const hash = chainHash(prevHash, {
      eventId,
      streamId: folded.stream.id,
      version,
      name: draft.type,
      schemaVersion,
      data,
      before: null,
      hlc,
      recordedAt: input.now,
      actor: meta.actor,
      writer: meta.writer,
      flags: meta.flags,
      decision: meta.decision,
      commandId: meta.commandId,
      client: meta.client,
    });
    events.push({
      eventId,
      name: draft.type,
      schemaVersion,
      shape,
      data,
      before: null,
      hlc,
      recordedAt: input.now,
      meta,
      transient: false,
      prevHash,
      hash,
    });
    prevHash = hash;
  }
  if (events.length === 0) return [];
  await unit.events.append([
    {
      stream: folded.stream,
      expectedVersion: folded.version,
      partition: null,
      events,
      tenancy: 'tenant',
    },
  ]);
  return events.map((event) => event.eventId);
}
