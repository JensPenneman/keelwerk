import type { Membership } from '../principals/membership.ts';
import type { Principal } from '../principals/principal.ts';
import type { Gen } from '../protocol/gen.ts';

/** A pure generator of loads that adds roles and memberships once per session (section 8.5). */
export interface PrincipalEnricher {
  readonly id: string;
  enrich(principal: Principal): Gen<{
    readonly roles?: readonly string[];
    readonly memberships?: readonly Membership[];
  }>;
}
