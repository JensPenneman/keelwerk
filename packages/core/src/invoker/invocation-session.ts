import type { TenantResolver } from '../edge/tenant-resolver.ts';
import type { Principal } from '../principals/principal.ts';
import type { Scope } from '../storage/scope.ts';
import type { Outcome } from './outcome.ts';

/** Scope and principal resolved once per transport request or connection; only the invoker creates one (section 16.3.4). */
export interface InvocationSession {
  readonly scope: Scope;
  /** The app of the resolved backend; 'core' at deployment level. */
  readonly app: string;
  /** Kind 'anonymous' when no credentials were presented. */
  readonly principal: Principal;
  /** Resolved by `resolveVersion` (section 18.3). */
  readonly apiVersion: string;
  /** Set when the session's API version is deprecated. */
  readonly deprecation: { readonly at: string; readonly sunset?: string } | null;
  /** Cookie names the host clears on the response, copied from the resolution. */
  readonly clearCookies?: readonly string[];
  /** Which tenant resolver matched; the cookie hint of S-48 applies under 'hostname' only. */
  readonly resolvedBy: TenantResolver['kind'] | 'local';
  /** When the presented credentials stop being valid. */
  readonly expiresAt?: Temporal.Instant;
  /** Runs `resolvePrincipal` again from the retained carrier; used by long-lived connections. */
  revalidate(): Promise<Outcome<InvocationSession>>;
}
