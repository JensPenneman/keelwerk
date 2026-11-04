import type { Carrier } from '../invoker/carrier.ts';
import type { Gen } from '../protocol/gen.ts';
import type { Scope } from '../storage/scope.ts';
import type { PrincipalResolution } from './principal-resolution.ts';

/**
 * A pure generator over the carrier that yields loads and secret verifications and returns the
 * principal it resolved, or null when the carrier holds nothing it accepts (sections 8.5 and 17.2.4).
 * A bearer credential that is present but invalid throws an `unauthenticated` error.
 */
export interface PrincipalResolver {
  /** 'auth.session', 'api-keys.key', 'core.operator'. */
  readonly id: string;
  /** For the OpenAPI security schemes (section 16.5.5). */
  describe(): {
    readonly scheme: 'bearer' | 'cookie' | 'apiKey';
    readonly name?: string;
    readonly description?: string;
  };
  resolve(
    carrier: Carrier,
    ctx: { readonly scope: Scope; readonly clock: { now(): Temporal.Instant } },
  ): Gen<PrincipalResolution | null>;
}
