import type { ActorRef } from '../principals/actor-ref.ts';
import type { DecisionRecord } from './decision-record.ts';
import { encodeDecisionRecord } from './encode-decision-record.ts';
import type { FlagRead } from './flag-read.ts';
import type { Hlc } from './hlc.ts';

/** The members of an event the hash chain covers (section 15.1.8, S-60). */
export interface ChainFields {
  readonly eventId: string;
  /** The stream id; the stream type, and so the module id, is not hashed. */
  readonly streamId: string;
  readonly version: number;
  /** The local event name: 'created', not 'library.book.created'. */
  readonly name: string;
  readonly schemaVersion: number;
  /** As stored: personal values are ciphertext. */
  readonly data: unknown;
  readonly before: unknown;
  readonly hlc: Hlc | string;
  readonly recordedAt: Temporal.Instant;
  readonly actor: ActorRef;
  readonly writer: { readonly build: string; readonly revision: number };
  readonly flags: readonly FlagRead[];
  readonly decision: DecisionRecord | null;
  readonly commandId: string | null;
  readonly client: { readonly id: string; readonly seq: number } | null;
}

/**
 * The value `canonicalizeJson` turns into the text the chain hashes: the list of 15.1.8 with
 * `writer`, `flags` and the decision record, in their stored JSON forms. The recorded time is its
 * ISO text at millisecond precision, the precision every adapter stores.
 */
export function chainContent(fields: ChainFields): Readonly<Record<string, unknown>> {
  return {
    eventId: fields.eventId,
    streamId: fields.streamId,
    version: fields.version,
    name: fields.name,
    schemaVersion: fields.schemaVersion,
    data: fields.data ?? null,
    before: fields.before ?? null,
    hlc: fields.hlc,
    recordedAt: Temporal.Instant.fromEpochMilliseconds(
      fields.recordedAt.epochMilliseconds,
    ).toString({ fractionalSecondDigits: 3 }),
    actor: { kind: fields.actor.kind, id: fields.actor.id, via: fields.actor.via },
    writer: { build: fields.writer.build, revision: fields.writer.revision },
    flags: fields.flags.map((flag) => ({
      key: flag.key,
      variant: flag.variant,
      reason: flag.reason,
      ruleVersion: flag.ruleVersion,
    })),
    decision: fields.decision === null ? null : encodeDecisionRecord(fields.decision),
    commandId: fields.commandId,
    client: fields.client === null ? null : { id: fields.client.id, seq: fields.client.seq },
  };
}
