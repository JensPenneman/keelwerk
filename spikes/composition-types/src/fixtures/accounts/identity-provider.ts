import type { Id } from '../../id.ts';
import type { Gen } from '../../request.ts';

/** The contract of the extension point accounts declares for login modules. */
export interface IdentityProvider {
  readonly id: string;
  readonly label: string;
  listFor(profileId: Id<'accounts.profile'>): Gen<readonly string[]>;
}
