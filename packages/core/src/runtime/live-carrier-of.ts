import type { LiveCarrier } from '../live/live-carrier.ts';
import type { Registry } from '../registry/registry.ts';

/** The first plain (unbound) fill of `core.liveCarriers` with this name and a `serve` function; undefined when the app has none. */
export function liveCarrierOf(registry: Registry, name: string): LiveCarrier | undefined {
  for (const entry of registry.fills.get('core.liveCarriers') ?? []) {
    if (entry.bound) continue;
    const value: unknown = entry.fill;
    if (
      typeof value === 'object' &&
      value !== null &&
      Reflect.get(value, 'name') === name &&
      typeof Reflect.get(value, 'serve') === 'function'
    ) {
      return value as LiveCarrier;
    }
  }
  return undefined;
}
