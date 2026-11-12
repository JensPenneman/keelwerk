import type { Clock } from '../kernel/clock.ts';
import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { Gen } from '../protocol/gen.ts';
import type { Scope } from '../storage/scope.ts';
import type { PrincipalResolution } from './principal-resolution.ts';

/** Re-resolution of a stored principal reference when a job runs (section 7.4, S-122). */
export interface PrincipalFromRef {
  /**
   * Same context and answer as `PrincipalResolver.resolve`: null when the reference no longer
   * resolves (a revoked key, a deleted user), and the job fails `unauthenticated`.
   */
  fromRef(
    ref: PrincipalRef,
    context: {
      readonly scope: Scope;
      readonly clock: Clock;
      /**
       * The transport the reference is redeemed on: the carrier's for a stream ticket and for the
       * revalidation of the session a ticket opened; for a job, the transport its accepted receipt
       * records, null when it has none (an enqueue effect, a deferred invoke) or the receipt is gone.
       * A resolver that binds a credential to transports refuses the reference when this is null or
       * is not one it names.
       */
      readonly transport: string | null;
    },
  ): Gen<PrincipalResolution | null>;
}
