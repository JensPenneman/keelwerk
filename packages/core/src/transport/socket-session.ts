import type { Carrier } from '../invoker/carrier.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { Outcome } from '../invoker/outcome.ts';
import type { LiveClientMessage } from '../live/live-client-message.ts';

/** What the host keeps for a transport's WebSocket (16.3.3, 15.4.10): its session, its checks and its bounds; a transport adds none of its own. */
export interface SocketSession {
  /** The session of the socket: the upgrade's until `open`, then the opened one, replaced by each revalidation. */
  session(): InvocationSession;
  /** The carrier invocations of this socket are given (credentials included, for resolvers only). */
  carrier(): Carrier;
  /**
   * First-message credentials, as the hello of `keelwerk.live.v1`; once per socket (a second call
   * throws `TypeError`). Ends the first-message wait, starts the session check and the ping loop. The
   * session it opens must belong to the registered app and pass the handler's `refuse` again, as the
   * upgrade's did. A refusal closes the socket with the close code of its kind and the error code as reason.
   */
  open(
    credentials: Omit<Extract<LiveClientMessage, { readonly type: 'hello' }>, 'type'>,
  ): Promise<Outcome<InvocationSession>>;
  /**
   * One subscription slot under `id` (`maxSubscriptionsPerSocket`, then the tenant, process and
   * anonymous address bounds). Throws `core.malformed_request` for an open id, `core.quota_exceeded`
   * past a bound, `TypeError` before `open`. `signal` aborts when the host ends it (socket end,
   * version retired); `release` is idempotent.
   */
  subscription(id: string): { readonly signal: AbortSignal; release(): void };
  /** Runs the session check now (a subscription failed unauthenticated); false when the session did not hold and the socket is closing. */
  check(): Promise<boolean>;
  /** Aborted when the socket ends. */
  readonly signal: AbortSignal;
}
