import { errors } from '../errors/errors.ts';
import type { LiveHubFiller } from '../live/live-hub-filler.ts';
import type { Registry } from '../registry/registry.ts';

/**
 * The first fill of the core's `liveHub` point, or undefined when the app has no live module. It
 * must be a plain value made by `defineLiveHub`: a factory fill is bound to its contributor's context
 * per invocation, which a hub that keeps readers across subscriptions cannot be, so any other fill
 * is `internal` and the runtime refuses to start.
 */
export function liveHubFillerOf(registry: Registry): LiveHubFiller | undefined {
  const [fill] = registry.fills.get('core.liveHub') ?? [];
  if (fill === undefined) return undefined;
  const value: unknown = fill.fill;
  if (
    fill.bound ||
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'kind') !== 'liveHubFiller' ||
    typeof Reflect.get(value, 'open') !== 'function'
  ) {
    throw errors.internal('The liveHub point takes a value made by defineLiveHub.');
  }
  return value as LiveHubFiller;
}
