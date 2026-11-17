import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { HttpContext } from './http-context.ts';
import type { SocketSession } from './socket-session.ts';

/** The handler of a WebSocket endpoint (section 16.3.3); the socket is the web-standard `WebSocket`, the spec's `WebSocketLike` being undefined. */
export interface WebSocketHandler {
  /**
   * Asked before the handshake, after the host's retired-version and origin checks: an error refuses
   * the upgrade with its status. Only for a transport's own reasons (its WebSocket option is off); the
   * answer says no more than the HTTP answer for the same request would.
   */
  refuse?(ctx: HttpContext): KeelwerkError | undefined;
  /**
   * The upgrade request's session may be anonymous; protocols with first-message credentials open a
   * new session through `connection`, which also holds the host's checks and bounds of the socket.
   */
  open(socket: WebSocket, ctx: HttpContext, connection: SocketSession): void;
}
