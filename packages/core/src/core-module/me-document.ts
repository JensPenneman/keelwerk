import type { CaslRule } from '../authorization/casl-rule.ts';
import type { Membership } from '../principals/membership.ts';

/** The answer of `core.me` (sections 8.7 and 16.2): who the session is and what it may do. */
export interface MeDocument {
  readonly principal: {
    readonly kind: 'anonymous' | 'user' | 'service' | 'operator' | 'system';
    /** Absent for the anonymous and system principals. */
    readonly id?: string;
    readonly roles: readonly string[];
    readonly memberships: readonly Membership[];
    readonly scope: { readonly backend: string | null; readonly tenant: string | null };
    readonly via: string;
    readonly expiresAt?: string;
    readonly apiVersion?: string;
  };
  /** The principal's effective rules in CASL raw-rule shape; relations resolved to id sets or `serverOnly`. */
  readonly rules: readonly CaslRule[];
}
