import type { AsyncReactionEvent } from '../dsl/define-reaction.ts';
import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Logger } from '../observability/logger.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { asyncReactionEventOf } from './async-reaction-event-of.ts';
import { countReactionFault } from './count-reaction-fault.ts';
import type { FoldedProcess } from './fold-process-state.ts';
import { foldProcessState } from './fold-process-state.ts';
import { isProcessStream } from './is-process-stream.ts';
import type { ReactionJobInput } from './reaction-job-input.ts';

/** The error a job fails with when the dispatcher marked its key unusable: the registered code, else `internal`. */
function keyErrorOf(reaction: ReactionEntry, code: string): KeelwerkError {
  const spec = Reflect.get(coreErrorCodes, code) as
    | (typeof coreErrorCodes)[keyof typeof coreErrorCodes]
    | undefined;
  if (spec === undefined || spec.kind !== 'validation') {
    return errors.internal(`the job of the reaction "${reaction.id}" carries an unknown key error`);
  }
  return new KeelwerkError({
    kind: 'validation',
    code,
    message: `The key of the reaction "${reaction.id}" cannot be used for this event: ${spec.message}`,
  });
}

/** What a job that decides nothing opens: the event or the subject is gone. */
function decidesNothing(reaction: ReactionEntry): OpenedAsyncReaction {
  return {
    reaction,
    event: undefined,
    process: undefined,
    decisionProcess: undefined,
    decide: () => undefined,
  };
}

/** The subject the job sealed; undefined when it was erased (when the job was queued or since). */
async function openSubject(
  unit: Unit,
  reaction: ReactionEntry,
  job: ReactionJobInput,
): Promise<string | undefined> {
  if (job.subject === null) return undefined;
  if (job.subject === undefined || job.processStream === undefined) {
    throw errors.internal(`the job of the process "${reaction.id}" names no subject`);
  }
  const sealer = personalSealerOf(unit);
  if (sealer === undefined) {
    throw errors.internal(`the unit cannot open the subject of the process "${reaction.id}"`);
  }
  return sealer.openProcessSubject({
    streamId: job.processStream,
    eventId: job.event,
    sealed: job.subject,
  });
}

/** An async reaction ready to decide in the unit of its job. */
export interface OpenedAsyncReaction {
  readonly reaction: ReactionEntry;
  /** Undefined when nothing is at (stream, version): a purged transient record; the job completes deciding nothing. */
  readonly event:
    | AsyncReactionEvent<string, unknown, Readonly<Record<string, unknown>>>
    | undefined;
  readonly process: FoldedProcess | undefined;
  /** For a process: what `ctx.events` of its decision builds drafts for (its id, the instance's stream, its event names). */
  readonly decisionProcess:
    | { readonly ref: string; readonly streamId: string; readonly events: readonly string[] }
    | undefined;
  /** `react(event, ctx)`, or `react(event, state, ctx)` for a process; undefined without an event. */
  decide(ctx: Readonly<Record<string, unknown>>): unknown;
}

/**
 * Reads the event a reaction job names, at (stream, version), in the job's unit, and builds what its
 * decision needs (7.7): the event as `asyncReactionEventOf` shows it (`current` read now) and, for a
 * process, its state folded from its stream. `internal` when the record at that place is another
 * event than the job names (the stream was rewritten, which nothing does) or when the job names an
 * event of a process's own stream (a forged or replayed job row: no reaction receives those). A job
 * the dispatcher marked with a `keyError` fails with that code. An event purged before the job ran,
 * and a process's subject erased before it ran, are each logged once and counted, and the job
 * decides nothing.
 */
export async function openAsyncReaction(input: {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly reaction: ReactionEntry;
  readonly input: ReactionJobInput;
  /** Where a purged event is logged, once per job. */
  readonly log?: Logger;
}): Promise<OpenedAsyncReaction> {
  const { unit, registry, reaction } = input;
  const job = input.input;
  if (job.keyError !== undefined) throw keyErrorOf(reaction, job.keyError);
  if (isProcessStream(registry, job.streamType)) {
    throw errors.internal(
      `the reaction "${reaction.id}" names an event of the state stream of a process`,
    );
  }
  const [stored] = await unit.events.readStream(
    { type: job.streamType, id: job.streamId },
    { fromVersion: job.version, toVersion: job.version, limit: 1 },
  );
  if (stored === undefined) {
    input.log?.warn('a reaction job found its event purged and decides nothing', {
      reaction: reaction.id,
      event: job.event,
    });
    countReactionFault('event_purged', reaction.id);
    return decidesNothing(reaction);
  }
  if (stored.eventId !== job.event) {
    throw errors.internal(
      `the reaction "${reaction.id}" names the event ${job.event}, and the stream holds ${stored.eventId} at version ${String(job.version)}`,
    );
  }
  let subject: string | undefined;
  if (reaction.process && reaction.dataSubject === 'instanceKey') {
    subject = await openSubject(unit, reaction, job);
    if (subject === undefined) {
      input.log?.warn('a process job found its subject erased and decides nothing', {
        reaction: reaction.id,
        event: job.event,
      });
      countReactionFault('subject_erased', reaction.id);
      return decidesNothing(reaction);
    }
  }
  const event = await asyncReactionEventOf(unit, registry, reaction.module, stored);
  if (reaction.process && job.processStream === undefined) {
    throw errors.internal(`the job of the process "${reaction.id}" names no instance`);
  }
  const process =
    reaction.process && job.processStream !== undefined
      ? await foldProcessState(unit, reaction, job.processStream, subject, input.log)
      : undefined;
  return {
    reaction,
    event,
    process,
    decisionProcess:
      process === undefined
        ? undefined
        : { ref: reaction.id, streamId: process.stream.id, events: reaction.events ?? [] },
    decide: (ctx) =>
      process === undefined
        ? reaction.react(event, ctx)
        : reaction.react(event, process.state, ctx),
  };
}
