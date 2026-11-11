import { errors } from '../errors/errors.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { LiveHubFiller } from './live-hub-filler.ts';
import type { LiveHubServices } from './live-hub-services.ts';
import type { RuntimeLiveHub } from './runtime-live-hub.ts';

function notOpened<T>(): AsyncIterable<LiveFrame<T>> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        Promise.reject(
          errors.internal('The live hub is opened by the runtime; subscribe through the invoker.'),
        ),
    }),
  };
}

/**
 * The value a module fills into the core's `liveHub` point (5.6, 15.4.1). It keeps nothing: the
 * runtime calls `open` once for each app it serves, with that runtime's own services, and uses the
 * hub that answers. Using the filler itself as a hub is `internal`.
 */
export function defineLiveHub(open: (services: LiveHubServices) => RuntimeLiveHub): LiveHubFiller {
  return Object.freeze({
    kind: 'liveHubFiller' as const,
    open,
    entity: notOpened,
    pokes: notOpened,
    stream: notOpened,
    topic: notOpened,
  });
}
