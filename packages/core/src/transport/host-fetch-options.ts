/** What an in-process `host.fetch` states that a socket would otherwise tell (16.8.5). */
export interface HostFetchOptions {
  /**
   * The client address of the request: an in-process call has no socket, so its caller names it;
   * absent, the loopback. The host takes the value as the client address exactly as given (put in
   * one standard form, a zone suffix refused), without the trusted-proxy rules, and no request
   * header sets it. It is the key of the login limit and of every address bucket: pass only an
   * address the caller has verified itself, such as a socket peer or the client entry that a
   * proxy it trusts added, never a header taken straight from the request (an
   * `x-forwarded-for` value passed on would let a client pick a fresh bucket for every attempt).
   */
  readonly remoteAddress?: string;
}
