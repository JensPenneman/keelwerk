import type { HostFetchOptions, Runtime } from '@keelwerk/core';
import type { ConnectOptions } from './connect-options.ts';
import type { SocketUpgrade } from './socket-upgrade.ts';
import type { TransportBounds } from './transport-bounds.ts';

/** A running deployment of the transport fixture app with its HTTP host listening in process. */
export interface TransportRuntime {
  readonly runtime: Runtime;
  /**
   * The host's dispatch (`runtime.host.fetch`), the one entry point the suite sends requests
   * through: each request comes from its own client address unless `options.remoteAddress` names
   * one; a header of the request never moves it. A conformance case about a per-address limit must
   * therefore name its address, since a request without one is a new client each time and the case
   * would pass even when the protection is broken.
   */
  fetch(request: Request, options?: HostFetchOptions): Promise<Response>;
  /**
   * Opens a WebSocket through the host's real upgrade path (`clientConnectOf`): the named address,
   * else a fresh one of the source `fetch` uses, is the forwarded entry of the upgrade. Absent when
   * the deployment does not listen; the socket cases are skipped then. Protocol-neutral: the path and
   * `Sec-WebSocket-Protocol` of the request pick the endpoint, so a GraphQL, tRPC or oRPC case uses it as is.
   * `options.answerPings: false` leaves the server's pings unanswered; aborting the request's signal
   * before the answer ends the handshake.
   */
  readonly connect?: (request: Request, options?: ConnectOptions) => Promise<SocketUpgrade>;
  readonly backendId: string;
  /** The configuration the backend was created with, by module id. */
  readonly backendConfig: Readonly<Record<string, unknown>>;
  /** Tenant name to id. */
  readonly tenants: Readonly<Record<string, string>>;
  /** The domain registered for each tenant. */
  readonly domains: Readonly<Record<string, string>>;
  /** The live bounds of the host's entry, which the socket and stream cases read instead of numbers of their own. */
  readonly bounds: TransportBounds;
  /** The newest API version the app serves: the version a tenant not pinned to another one is answered at. */
  readonly headApiVersion: string;
  /** Tenant name to the deprecated API version it is pinned to; a tenant on a version that is not deprecated is not listed. */
  readonly deprecatedPins: Readonly<Record<string, string>>;
  /** Revokes a subject: its test principal header and cookie are `unauthenticated` from then on (a job re-resolves it to nothing), so the next session check of a session held by it fails. */
  revoke(subject: string): void;
  /** The operator socket path the host listens on. */
  readonly socket: string;
  /**
   * Wakes the workers and settles once they are idle, answering the attempts they settled since the
   * previous drain; what it runs and leaves is said at `TestRuntime.drainJobs`. Throws `internal`
   * when the runtime was started without `workers` or `eventWorkers`.
   */
  drainJobs(): Promise<number>;
  stop(): Promise<void>;
}
