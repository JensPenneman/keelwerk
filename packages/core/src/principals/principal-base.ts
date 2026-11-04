import type { Membership } from './membership.ts';
import type { PrincipalRef } from './principal-ref.ts';

/** What every principal carries; `Ref` is the reference as the module whose part runs types it. */
export interface PrincipalBase<Ref extends PrincipalRef = PrincipalRef> {
  readonly scope: { readonly backend: string | null; readonly tenant: string | null };
  readonly claims: Readonly<Record<string, unknown>>;
  /** From principal enrichers; a convenience, never the whole model. */
  readonly roles: readonly string[];
  readonly memberships: readonly Membership[];
  /** Resolver id: 'auth.session', 'api-keys.key', 'core.operator', 'core.module'. */
  readonly via: string;
  /** What jobs and receipts store, typed by the module that resolves the principal. */
  readonly ref: Ref | null;
  /** When the presented credential stops being valid. */
  readonly expiresAt?: Temporal.Instant;
  /** From the credential: an API key created with a version (section 18.3). */
  readonly apiVersion?: string;
}
