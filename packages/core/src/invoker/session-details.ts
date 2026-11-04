import type { Carrier } from './carrier.ts';
import type { ResolvedScope } from './resolved-scope.ts';

/** What the invoker keeps beside a session it created: never given to a transport. */
export interface SessionDetails {
  readonly resolved: ResolvedScope;
  /** The carrier the session was opened from, retained for `revalidate`. */
  readonly carrier: Carrier;
}
