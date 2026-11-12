import type { Clock, LiveTimers } from '@keelwerk/core';

/** What one WebSocket connection is made with. */
export interface WebSocketConnectionOptions {
  /** The bytes a connection queues for its client: the carriers judge each message against it; the socket reads `bufferedBytes()` for them. */
  readonly maxBufferedBytes: number;
  /** A send left unflushed, or a close handshake left open, for this long cuts the socket. */
  readonly stallMs: number;
  /** No pong that echoes the ping within this long answers `ping()` false. */
  readonly pongTimeoutMs: number;
  /** The bytes of messages read and not yet taken that stop the socket reading (the host's `maxMessageBytes`). */
  readonly maxMessageBytes: number;
  readonly maxMessagesPerWindow: number;
  readonly messageWindowMs: number;
  /** The clock and the waits every bound of the connection runs on. */
  readonly clock: Clock;
  readonly timers: LiveTimers;
}
