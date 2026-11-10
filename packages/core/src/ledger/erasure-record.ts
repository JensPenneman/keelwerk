import type { ActorRef } from '../principals/actor-ref.ts';

/** The ledger record of a subject erasure (section 14.7.5 step 1). Stored, final once written (S-176). */
export interface ErasureRecord {
  readonly type: 'erasure';
  readonly tenantId: string;
  readonly subjectId: string;
  /** ISO 8601 instant, like the anchor's. */
  readonly recordedAt: string;
  readonly requester: ActorRef;
  readonly reason: string;
  /** The erasure command's id. */
  readonly commandId: string;
}
