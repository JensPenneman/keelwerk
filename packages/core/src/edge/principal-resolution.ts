import type { Principal } from '../principals/principal.ts';
import type { AnyEffect } from '../protocol/any-effect.ts';
import type { CredentialRedemption } from './credential-redemption.ts';

/** What a principal resolver returns. */
export interface PrincipalResolution {
  /** Ignored when `redeem` is set: the principal is then the one the redeemed credential's reference resolves to. */
  readonly principal: Principal;
  /** A single-use credential the resolver accepted: the kernel spends it, then resolves the principal its reference names (S-161). */
  readonly redeem?: CredentialRedemption;
  /** Performed in a short read-write unit right after `open`, for example auth's idle extension (section 9.2). */
  readonly effects?: readonly AnyEffect[];
  /** Cookie names the host clears, returned with an anonymous principal for a stale session (sections 16.3.4 and 16.4.10). */
  readonly clearCookies?: readonly string[];
  /**
   * What the kernel caches the session under and which change records drop it (section 17.2.4
   * step 4): one row (`entity`, `id`), or `drops` for several, such as a session and its credential.
   */
  readonly cache?:
    | { readonly key: string; readonly entity: string; readonly id: string }
    | {
        readonly key: string;
        readonly drops: readonly { readonly entity: string; readonly id: string }[];
      };
}
