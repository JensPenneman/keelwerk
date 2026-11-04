import type { StateToken } from '../events/state-token.ts';
import type { Carrier } from './carrier.ts';
import type { Invocation } from './invocation.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { LiveFrame } from './live-frame.ts';
import type { Outcome } from './outcome.ts';

/** The single entry point of the kernel, used by transports, listeners, the CLI, tests and the kernel itself (section 9.1). */
export interface Invoker {
  /** Runs `resolveScope` and `resolvePrincipal` once for a transport request or a long-lived connection. */
  open(
    carrier: Carrier,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Outcome<InvocationSession>>;
  invoke<I, O>(inv: Invocation<I>): Promise<Outcome<O>>;
  /** Items and control frames (head, reset, gap). */
  subscribe<I, E>(
    inv: Invocation<I>,
    resume?: { readonly after: StateToken },
  ): AsyncIterable<LiveFrame<E>>;
}
