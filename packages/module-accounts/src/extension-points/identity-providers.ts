import type { Gen, Id } from '@keelwerk/core';
import { extensionPoint } from '@keelwerk/core';

/** One sign-in method of a profile, as a login module describes it. */
export interface IdentitySummary {
  readonly kind: string;
  readonly label: string;
  readonly createdAt: Temporal.Instant;
}

/** The contract of the extension point accounts declares for login modules. */
export interface IdentityProvider {
  readonly id: string;
  readonly label: string;
  /** A pure generator, bound to its contributor's context: the contributor loads its own rows. */
  listFor(profileId: Id<'accounts.profile'>): Gen<readonly IdentitySummary[]>;
}

export const identityProviders = extensionPoint.set<IdentityProvider>();
