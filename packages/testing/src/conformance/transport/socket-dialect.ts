import type { SocketFrame } from './socket-frame.ts';
import type { SocketSubscribeAnswer } from './socket-subscribe-answer.ts';
import type { TestSocket } from './test-socket.ts';

/**
 * How one transport's WebSocket protocol is spoken in the shared socket cases: where it is
 * mounted, which subprotocol it asks for, how a socket is opened (the first message and its
 * acknowledgement) and how one subscription to the public stream `loans.loanTicker` is made and
 * answered. A transport without a dialect speaks `keelwerk.live.v1`. The cases of the protections
 * the host gives every socket (the anonymous cap per address, the subscription slots) run through
 * it, so a transport that forgets one of them fails the shared case.
 */
export interface SocketDialect {
  /** The `Sec-WebSocket-Protocol` the upgrade asks for and the 101 must answer. */
  readonly protocol: string;
  /** The path of the upgrade request. */
  readonly path: string;
  /** Sends the first message without credentials and reads its acknowledgement; throws when it does not come. */
  open(socket: TestSocket): Promise<void>;
  /** Subscribes under `id` to `loans.loanTicker` and reads the first answer to it. */
  subscribe(socket: TestSocket, id: string): Promise<SocketSubscribeAnswer>;
  /** Subscribes under `id` to `loans.loanTitles` (no input) and reads the first answer to it. */
  subscribeTitles(socket: TestSocket, id: string): Promise<SocketSubscribeAnswer>;
  /**
   * The next frame of the subscription `id`, classified as this protocol's client reads it; frames
   * of other subscriptions, notices and pongs are skipped; rejects after `ms` (default 10,000) or
   * when the socket closes.
   */
  frame(socket: TestSocket, id: string, ms?: number): Promise<SocketFrame>;
}
