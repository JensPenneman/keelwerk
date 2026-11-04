import type { Gen, Id } from '@keelwerk/core';

/** The contract of the extension point accounts declares for login modules. */
export interface IdentityProvider {
  readonly id: string;
  readonly label: string;
  listFor(profileId: Id<'accounts.profile'>): Gen<readonly string[]>;
}
