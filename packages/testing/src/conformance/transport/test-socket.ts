/** One open WebSocket of a conformance case, independent of the protocol it speaks. */
export interface TestSocket {
  /** Sends one message, masked as a client must: a string as a text frame, bytes as a binary frame. */
  send(data: string | Uint8Array): void;
  /** The next message (text as a string, binary as bytes); rejects after `ms` (default 10,000), or once the socket is closed with none left. */
  next(ms?: number): Promise<string | Uint8Array>;
  /** The close code and reason once the socket is gone: the server's close frame (1005 without a code), 1006 when it ended without one, 1002 on a protocol error. */
  readonly closed: Promise<{ readonly code: number; readonly reason: string }>;
  /**
   * Sends a ping (a payload of at most 125 bytes, 8 random bytes by default so that every ping has its own) and resolves with the payload of
   * the pong that answers it; rejects after `ms` (default 10,000), or once the socket is closed.
   * A payload that is used again after a timeout can be answered by the late pong of the earlier
   * ping, so a case that retries leaves the payload out or passes a fresh one.
   */
  ping?(payload?: Uint8Array, ms?: number): Promise<Uint8Array>;
  /**
   * Sends a close frame with `code` (default 1000) and `reason` (default none, at most 123 bytes of
   * UTF-8) unless one was sent, and resolves once the socket is gone (destroyed after 2,000 ms).
   */
  close(code?: number, reason?: string): Promise<void>;
}
