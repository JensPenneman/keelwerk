import type { CarrierEndReason, LiveFrame, WireError } from '@keelwerk/core';

/** What one connection of a subscription yields: wire frames, the end the server announced, or an error event. */
export type LiveLegEvent =
  | { readonly kind: 'frame'; readonly frame: LiveFrame<unknown> }
  | { readonly kind: 'end'; readonly reason: CarrierEndReason }
  | { readonly kind: 'error'; readonly error: WireError };
