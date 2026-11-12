import type { CarrierConnection } from '@keelwerk/core';

/** An accepted socket and the connection carriers and the endpoint use. */
export interface OpenLiveSocket {
  readonly connection: Extract<CarrierConnection, { readonly kind: 'websocket' }>;
  /** Close with a code of 15.4.7 / 16.4.6 and a reason the host wrote (never client text, at most 123 bytes); idempotent; a handshake not done within `stallMs` is cut. */
  closeWith(code: number, reason: string): void;
  /** Destroys the socket at once (missing pong, stall). */
  terminate(): void;
  /** `closeWith(1001, 'going_away')`; the host calls it at stop. */
  goAway(): void;
  /** The code of the close frame the socket ended with; absent while it is open or when it ended without one. */
  closeCode(): number | undefined;
  /** Resolves once the socket is gone and every listener and wait of the connection is released. */
  readonly closed: Promise<void>;
}
