import type { Principal } from '../principals/principal.ts';
import type { AnyEffect } from '../protocol/any-effect.ts';

/** What a principal resolver returns. */
export interface PrincipalResolution {
  readonly principal: Principal;
  /** Performed in a short read-write unit right after `open`, for example auth's idle extension (section 9.2). */
  readonly effects?: readonly AnyEffect[];
  /** Cookie names the host clears, returned with an anonymous principal for a stale session (sections 16.3.4 and 16.4.10). */
  readonly clearCookies?: readonly string[];
  /** What the kernel caches the session under and which change record drops it (section 17.2.4 step 4). */
  readonly cache?: {
    readonly key: string;
    readonly entity: string;
    readonly id: string;
  };
}
