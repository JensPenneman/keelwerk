/** What `httpHost({ ... })` takes in the deployment's infrastructure list (section 16.3.3). */
export interface HttpHostOptions {
  /** The TCP listener; absent means the host serves `fetch` and the operator socket only. */
  readonly listen?: {
    /** 0 picks a free port. */
    readonly port: number;
    /** Default: the loopback address, so exposing the host is always a deliberate choice. */
    readonly hostname?: string;
  };
  /** CIDR ranges whose forwarding headers name the client address; empty by default (S-38). */
  readonly trustedProxies?: readonly string[];
  /** Request body limit in bytes; default 1 MiB (section 16.4.11). */
  readonly maxBodyBytes?: number;
}
