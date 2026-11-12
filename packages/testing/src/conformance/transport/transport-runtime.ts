import type { HostFetchOptions, Runtime } from '@keelwerk/core';
import type { ConnectOptions } from './connect-options.ts';
import type { SocketUpgrade } from './socket-upgrade.ts';

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
  /** The operator socket path the host listens on. */
  readonly socket: string;
  stop(): Promise<void>;
}
