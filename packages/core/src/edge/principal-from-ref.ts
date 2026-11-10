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
    context: { readonly scope: Scope; readonly clock: Clock },
  ): Gen<PrincipalResolution | null>;
}
