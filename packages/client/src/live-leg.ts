import type { LiveLegEvent } from './live-leg-event.ts';

/** What one connection of a subscription is asked for. */
export interface LiveLegRequest {
  readonly action: string;
  /** Wire form. */
  readonly input?: unknown;
  readonly after?: string;
}

/**
 * Opens one connection of a subscription. Resolves once the server accepted it; rejects with its
 * refusal. The events end when the connection ends; `return()` closes it. Items stay in their wire form.
 */
export type LiveLeg = (
  request: LiveLegRequest,
  signal: AbortSignal,
) => Promise<AsyncIterable<LiveLegEvent>>;
