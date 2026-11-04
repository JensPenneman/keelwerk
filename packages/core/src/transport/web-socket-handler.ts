import type { HttpContext } from './http-context.ts';

/** The handler of a WebSocket endpoint (section 16.3.3); the socket is the web-standard `WebSocket`, the spec's `WebSocketLike` being undefined. */
export interface WebSocketHandler {
  /** The upgrade request's session may be anonymous; protocols with first-message credentials open a new session. */
  open(socket: WebSocket, ctx: HttpContext): void;
}
