import type { ActorRef } from '../principals/actor-ref.ts';

/** One row of kw_queue_pauses (S-121): deployment-wide (scopeId null) or for one scope. */
export interface QueuePause {
  readonly queue: string;
  readonly scopeId: string | null;
  readonly pausedBy: ActorRef;
  readonly reason: string;
  readonly pausedAt: Temporal.Instant;
}
