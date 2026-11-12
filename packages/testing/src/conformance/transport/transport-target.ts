import type { HostFetchOptions } from '@keelwerk/core';
import type { ConnectOptions } from './connect-options.ts';
import type { SocketUpgrade } from './socket-upgrade.ts';
import type { TransportCodec } from './transport-codec.ts';

/** What the suite runs against: a request function, a codec and the deployment's tenants. */
export interface TransportTarget {
  /** The name shown in the test titles. */
  readonly name: string;
  /**
   * The host's dispatch: `runtime.host.fetch`, or `fetch` against a listening port. Each request
   * comes from its own client address unless `options.remoteAddress` names one, so a case about a
   * per-address limit or protection must name its address: otherwise every request is a new client
   * and the case passes even when the protection is broken.
   */
  readonly fetch: (request: Request, options?: HostFetchOptions) => Promise<Response>;
  /**
   * Opens a WebSocket through the host's real upgrade path (`clientConnectOf`): the named address,
   * else a fresh one of the source `fetch` uses, is the forwarded entry of the upgrade. Absent when
   * the deployment does not listen; the socket cases are skipped then. Protocol-neutral: the path and
   * `Sec-WebSocket-Protocol` of the request pick the endpoint, so a GraphQL, tRPC or oRPC case uses it as is.
   * `options.answerPings: false` leaves the server's pings unanswered; aborting the request's signal
   * before the answer ends the handshake. The hook speaks plain http to the test host, so a case
   * about a rule that holds only for https requests cannot be written with it yet.
   */
  readonly connect?: (request: Request, options?: ConnectOptions) => Promise<SocketUpgrade>;
  readonly codec: TransportCodec;
  /** The tenants of the backend, by name. */
  readonly tenants: Readonly<Record<string, { readonly id: string; readonly domain: string }>>;
  /** The origins the backend's REST `cors` setting allows. */
  readonly cors: readonly string[];
  /** The configuration the target's backend was started with, by module id. */
  readonly backendConfig: Readonly<Record<string, unknown>>;
  /** A `fetch` over the operator socket (the client's `unixSocketFetch`). */
  readonly operatorFetch: (request: Request) => Promise<Response>;
  /** Whether the deployment runs the live module (its stream endpoint answers); the subscription scenarios run only then. */
  readonly live?: boolean;
}
