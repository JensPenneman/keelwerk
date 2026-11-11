import type { LiveHub } from './live-hub.ts';
import type { LiveHubServices } from './live-hub-services.ts';
import type { RuntimeLiveHub } from './runtime-live-hub.ts';

/**
 * What a module fills into the core's `liveHub` point (5.6, 15.4.1): a value that holds no state
 * and opens one hub for each runtime that serves the app. It is a `LiveHub` so the point's type
 * stays the frozen one; its own members refuse and say who opens it.
 */
export interface LiveHubFiller extends LiveHub {
  readonly kind: 'liveHubFiller';
  open(services: LiveHubServices): RuntimeLiveHub;
}
