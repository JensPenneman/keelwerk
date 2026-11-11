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
}
