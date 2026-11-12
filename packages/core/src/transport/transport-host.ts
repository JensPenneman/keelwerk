import type { HostFetchOptions } from './host-fetch-options.ts';
import type { HttpHandler } from './http-handler.ts';
import type { WebSocketHandler } from './web-socket-handler.ts';

/** The deployment's HTTP host, which transports mount on (section 16.3.3). */
export interface TransportHost {
  /** An HTTP handler for one app under a path prefix; prefixes of one app must not overlap. */
  route(
    spec: {
      readonly app: string;
      readonly transport: string;
      readonly prefix: string;
    },
    handler: HttpHandler,
  ): void;
  /** A WebSocket endpoint for one app, selected by path and subprotocol. */
  upgrade(
    spec: {
      readonly app: string;
      readonly transport: string;
      readonly path: string;
      readonly protocols: readonly string[];
    },
    handler: WebSocketHandler,
  ): void;
  /**
   * Dispatches a request through the host's own routing, for `runtime.host.fetch` (sections 16.8.5
   * and S-52). The client address of an in-process request is `options.remoteAddress`, else the
   * loopback (16.8.5). The caller must verify that address itself: the host takes it as given,
   * without the trusted-proxy rules, and it keys the login limit (see `HostFetchOptions`).
   */
  fetch(request: Request, options?: HostFetchOptions): Promise<Response>;
}
