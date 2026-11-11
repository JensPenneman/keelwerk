import type { KweEnvelope } from '../keys/kwe-envelope.ts';

/**
 * What a reaction job stores as its input (final): a reference to the event, never its data, so the
 * job row holds no personal value. The event is read again when the job runs, at (stream, version).
 */
export interface ReactionJobInput {
  /** The event id. */
  readonly event: string;
  readonly streamType: string;
  readonly streamId: string;
  /** The event's stream version. */
  readonly version: number;
  /**
   * The event's position in the log, as decimal text (a position may exceed what a JSON number
   * holds). A coalescing reaction's key keeps the pending job of the later event, so an older event
   * delivered late (a replayed stream) never replaces a newer one.
   */
  readonly position: string;
  /**
   * A process job: the id of the instance's state stream, derived by the dispatcher from the
   * instance key when it queued the job (`processStreamRef`; one-way, so it holds no key). The job
   * folds this stream and never computes the key again, so a deploy that changes the key function
   * leaves the queued jobs on their instances.
   */
  readonly processStream?: string;
  /**
   * A process job of a process that declares its data subject: the instance key sealed under the
   * subject's data key (`sealProcessSubject`), the subject the job's events are sealed for;
   * `null` when the subject was already erased when the job was queued. A subject whose keys are
   * destroyed since cannot be opened: the job then decides nothing.
   */
  readonly subject?: KweEnvelope | null;
  /**
   * Set by the dispatcher when the reaction's key failed for the event (it threw, answered nothing
   * or an empty text, or is no data subject id): the code the job fails with when it runs, so the
   * fault ends as that reaction's dead letter and holds back no other reaction.
   */
  readonly keyError?: string;
}
