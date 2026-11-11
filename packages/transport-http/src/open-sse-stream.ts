import type { CarrierConnection } from '@keelwerk/core';

/** An open server-sent event response and the connection a carrier writes it through. */
export interface OpenSseStream {
  readonly connection: Extract<CarrierConnection, { readonly kind: 'sse' }>;
  /** 200, `text/event-stream; charset=utf-8`, `cache-control: no-store`, `x-accel-buffering: no`. */
  readonly response: Response;
  /** Ends the stream with `going_away` and aborts its subscription; idempotent. The host calls it at stop. */
  goAway(): Promise<void>;
  /** Closes the body once the queued bytes are sent and writes nothing more; idempotent. The host calls it when the carrier returns. */
  finish(): void;
}
