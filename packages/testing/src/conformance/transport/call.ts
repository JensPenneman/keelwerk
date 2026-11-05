/** Who sends a call and how: the tenant by its domain, the principal as plain data, and the browser facts. */
export interface Caller {
  /** A tenant name of the target; default: the first. */
  readonly tenant?: string;
  /** The signed-in subject; `null` or absent is anonymous. */
  readonly subject?: string | null;
  /** The roles of the signed-in subject. */
  readonly roles?: readonly string[];
  /** The raw value of the test session cookie (`__Host-kw-test`), as a browser sends it. */
  readonly cookie?: string;
  /** A browser's `Origin` header. */
  readonly origin?: string;
  /** A browser's `Sec-Fetch-Site` header. */
  readonly fetchSite?: 'same-origin' | 'same-site' | 'cross-site' | 'none';
  /** Headers added as they are. */
  readonly headers?: Readonly<Record<string, string>>;
  /** A path segment before the transport's own path, as a client that names a scope in the URL sends it. */
  readonly pathPrefix?: string;
  /** The host name to send to, when it is not the tenant's domain. */
  readonly host?: string;
}

/** One invocation of an action, independent of the transport that carries it. */
export interface Call {
  /** The action reference, 'loans.lend'. */
  readonly action: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly caller?: Caller;
  /** The idempotency key of a command. */
  readonly commandId?: string;
  readonly prefer?: 'async' | 'sync';
  /** The version a row must still have (`If-Match` on REST, `ifVersion` in the input on the protocol). */
  readonly ifVersion?: number;
}
