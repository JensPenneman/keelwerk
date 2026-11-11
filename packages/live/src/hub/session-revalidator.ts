import type { LiveSubscription } from './live-subscription.ts';

/** What revalidates the sessions of a hub's streams (16.3.4): on a timer, at `expiresAt`, and when the hub asks. */
export interface SessionRevalidator {
  /** Revalidates now; resolves once the subscription is renewed or ended. Never rejects. */
  revalidate(subscription: LiveSubscription): Promise<void>;
  /** The hub's member count: the tick timer runs while it is above 0. */
  attached(count: number): void;
  /** Stops the timer; results that arrive later renew nothing. */
  close(): void;
}
