import type { RuntimeLiveHub } from '@keelwerk/core';
import type { LiveSubscription } from './live-subscription.ts';

/**
 * The hub one runtime opened for one app, and the subscriptions it runs for the revalidation that
 * the live module builds later. `close` ends every subscription without a frame or an error, stops
 * the readers and timers, and is the runtime's to call when it stops. The list holds this hub's
 * subscriptions only, and is empty after `close`.
 */
export interface LiveHubService extends RuntimeLiveHub {
  subscriptions(): readonly LiveSubscription[];
}
