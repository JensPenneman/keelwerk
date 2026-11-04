/** Where a started host listens. */
export interface HttpHostListening {
  /** The TCP port, when a listener is configured. */
  readonly port?: number;
  /** The operator socket path actually used, after the short-path fallback. */
  readonly operatorSocket?: string;
}
