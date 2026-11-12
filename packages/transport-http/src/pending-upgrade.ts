import type { IncomingMessage } from 'node:http';
import type { WebSocket as WsSocket } from 'ws';

/** An upgrade request the Node server handed the host, not yet answered. */
export interface PendingUpgrade {
  readonly incoming: IncomingMessage;
  /**
   * Completes the handshake with `protocol` (ws `handleUpgrade`): true once `open` ran, false when ws
   * refused the handshake (the socket was closed first).
   */
  accept(protocol: string, open: (socket: WsSocket) => void): Promise<boolean>;
}
