import type { Caller } from './call.ts';

/** One subscription request, independent of the transport that carries it. */
export interface SubscribeCall {
  /** The subscription reference, 'loans.loanEvents'. */
  readonly action: string;
  readonly input?: unknown;
  readonly caller?: Caller;
  /** The token to resume after, as the `after` member. */
  readonly after?: string;
  /** The token as the `Last-Event-ID` header a browser sends on a reconnect; it wins over `after`. */
  readonly lastEventId?: string;
  /** A stream ticket in the query (GET only). */
  readonly ticket?: string;
  /** The client address the request comes from; absent, the target gives it a fresh one. A case about a per-address limit must name it. */
  readonly remoteAddress?: string;
  /** Default GET: what an `EventSource` sends. */
  readonly method?: 'GET' | 'POST';
}
