import type { ActorRef } from '../principals/actor-ref.ts';

/**
 * One row of kw_queue_pauses (S-121): every namespace of the deployment when namespaceId is null,
 * every scope of the namespace when scopeId is null.
 */
export interface QueuePause {
  readonly namespaceId: string | null;
  readonly queue: string;
  readonly scopeId: string | null;
  readonly pausedBy: ActorRef;
  readonly reason: string;
  readonly pausedAt: Temporal.Instant;
}
