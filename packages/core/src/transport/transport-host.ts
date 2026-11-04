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
  /** Dispatches a request through the host's own routing, for `runtime.host.fetch` (sections 16.8.5 and S-52). */
  fetch(request: Request): Promise<Response>;
}
