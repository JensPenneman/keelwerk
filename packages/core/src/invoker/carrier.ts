import type { ScopeKey } from '../edge/scope-directory.ts';
import type { Connection } from './connection.ts';
import type { JobCarrier } from './job-carrier.ts';

/** What a transport or listener knows of a request before scope and principal are resolved (section 16.4.10). */
export interface Carrier {
  /** The stable transport name: 'rest', 'graphql', 'trpc', 'cli', 'webhooks', a listener id. */
  readonly transport: string;
  /** The request's host name, for `byHostname`. */
  readonly host?: string;
  readonly path?: string;
  /** Lower-case names; read only by resolvers and enrichers. */
  readonly headers?: Readonly<Record<string, string>>;
  /** A bearer token the transport extracted. */
  readonly token?: string;
  readonly connection?: Connection;
  readonly sasl?: {
    readonly mechanism: string;
    readonly authcid: string;
    readonly authzid?: string;
    readonly secret: string;
  };
  /** Set by carrier enrichers, listeners and token parsers (gap G2). */
  readonly scopeKey?: ScopeKey;
  /** Webhook receivers (section 16.5.8). */
  readonly receiver?: string;
  /** The operator socket, or the CLI's project mode and tests. */
  readonly local?: { readonly socket: string } | { readonly inProcess: true };
  /** A worker's invocation of a job's action: its scope and principal reference stand in for credentials (S-122). Set by the worker only, like `local`. */
  readonly job?: JobCarrier;
  /**
   * A stream ticket presented in the query of `GET /_keelwerk/v1/subscribe`; set by the HTTP host on
   * that endpoint only, which then drops the cookie and authorization headers, so a request holds one credential.
   */
  readonly ticket?: {
    readonly value: string;
    readonly endpoint: 'subscribe';
    /** The subscription the request asks for; the ticket is bound to it when it names one. */
    readonly action: string | null;
    /**
     * The host spends a ticket that was presented where it may not be and refuses the request: the
     * ticket's binding to an endpoint and a subscription is not checked. The kernel spends such a
     * ticket and always refuses the request with core.ticket_invalid; it never yields a session.
     */
    readonly spendOnly?: true;
  };
}
