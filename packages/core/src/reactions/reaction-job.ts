import { jobInput } from '../effects/job-input.ts';
import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import { kernelCommandId } from '../ids/kernel-command-id.ts';
import type { JobSpec } from '../jobs/job-spec.ts';
import type { KweEnvelope } from '../keys/kwe-envelope.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import { moduleServicePrincipal } from './module-service-principal.ts';
import type { ReactionJobInput } from './reaction-job-input.ts';
import { reactionJobKey } from './reaction-job-key.ts';
import { reactionKeyValue } from './reaction-key-value.ts';
import { reactionQueue } from './reaction-queue.ts';

/** What the job of one async reaction for one event is built from. */
export interface ReactionJobOptions {
  readonly reaction: ReactionEntry;
  readonly event: StoredEvent;
  /** The reaction's `key(event)`, computed by the dispatcher; undefined when it declares none. */
  readonly declaredKey: string | undefined;
  /**
   * The code the job fails with when it runs, because the reaction's key failed for the event (see
   * `ReactionJobInput.keyError`). The job then stands alone: its key is the event's, it keeps, and
   * it orders and coalesces nothing.
   */
  readonly keyError?: string;
  /** A process job: the id of the instance's stream (see `ReactionJobInput.processStream`). */
  readonly processStream?: string;
  /** A process job of a process with a data subject: the sealed subject, `null` when erased (see `ReactionJobInput.subject`). */
  readonly subject?: KweEnvelope | null;
  /** The enqueuer's build (section 19.2). */
  readonly build: { readonly id: string; readonly revision: number };
  readonly now: Temporal.Instant;
}

/**
 * The job of one async reaction for one event (7.7, 9.5.1; the stored form is final): an action job
 * on the queue `reactions` that runs the reaction under its module's service principal, in the
 * event's scope, with the event as its cause and the event's actor as the causing actor. The run is
 * the reaction's id with the event reference as input and `kernel:reaction:<reaction id>:<event id>` (`kernelCommandId`) as command id,
 * which is the idempotency key of (reaction, event); the key, ordering, group, retry and dead
 * letter come from the reaction. A coalescing reaction is `fifo-per-key` too. `validation` when
 * `declaredKey` is the empty string.
 */
export function reactionJob(options: ReactionJobOptions): JobSpec {
  const { reaction, event, declaredKey, keyError, processStream, subject, build, now } = options;
  if (declaredKey === '') {
    throw errors.validation(`The key of the reaction "${reaction.id}" is empty for an event.`);
  }
  const { scope } = event;
  const principal = moduleServicePrincipal(reaction.module, {
    scope: {
      backend: scope.level === 'deployment' ? null : scope.backendId,
      tenant: scope.level === 'tenant' ? scope.tenantId : null,
    },
  });
  const common = jobInput({
    scope,
    principal,
    actor: event.actor,
    causation: {
      eventId: event.eventId,
      ...(event.commandId === null ? {} : { commandId: event.commandId }),
    },
    caller: reaction.module,
    action: { module: reaction.module, ref: reaction.id },
    build,
    now,
  });
  const input: ReactionJobInput = {
    event: event.eventId,
    streamType: event.stream.type,
    streamId: event.stream.id,
    version: event.version,
    position: event.position.toString(),
    ...(processStream === undefined ? {} : { processStream }),
    ...(subject === undefined ? {} : { subject }),
    ...(keyError === undefined ? {} : { keyError }),
  };
  const coalescing = reaction.coalesce === true;
  return {
    queue: reactionQueue,
    run: {
      action: reaction.id,
      input,
      commandId: kernelCommandId('reaction', reaction.id, event.eventId),
    },
    scope: common.scope,
    principal: common.principal,
    causation: common.causation,
    build: common.build,
    key:
      keyError === undefined
        ? reactionJobKey(reaction, event, declaredKey)
        : { value: reactionKeyValue(reaction, event.eventId), onConflict: 'keep' as const },
    // A coalescing reaction is also ordered: a newer event waits behind the older one that is
    // still running, so the last write is always the newest event's.
    ...(keyError === undefined && (reaction.ordering === 'fifo-per-key' || coalescing)
      ? { ordering: 'fifo-per-key' as const }
      : {}),
    ...(reaction.concurrency === undefined
      ? {}
      : { group: { id: reaction.id, concurrency: reaction.concurrency } }),
    ...(reaction.retry === undefined ? {} : { retry: reaction.retry }),
    deadLetter: reaction.id,
  };
}
