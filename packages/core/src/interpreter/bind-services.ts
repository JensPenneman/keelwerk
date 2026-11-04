import { camelFromKebab } from '../naming/camel-from-kebab.ts';
import type { ModuleEntry } from '../registry/module-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { buildMaybeAccessor } from './build-maybe-accessor.ts';
import type { RequestAuthorities } from './request-authorities.ts';

type Services = Readonly<Record<string, unknown>>;

/**
 * `ctx.services` (section 5.5): the services of the modules a part's module requires, each bound to
 * its provider's own context, so it loads with the provider's authority under the caller's
 * principal. A call returns what the service returns (a value, a request or a generator) for the
 * part to `yield*`. Optional modules go through the Maybe accessor.
 */
export function bindServices(
  registry: Registry,
  module: ModuleEntry,
  contextOf: (module: string) => unknown,
  authorities: RequestAuthorities,
): Services {
  const find = (id: string): ModuleEntry | undefined =>
    registry.modules.find((entry) => entry.id === id);
  const servicesOf = (provider: ModuleEntry): Services => {
    const bound: Record<string, unknown> = {};
    for (const reference of provider.services) {
      const service = registry.services.get(reference);
      if (service === undefined) continue;
      bound[service.name] = (...args: readonly unknown[]) =>
        service.fn(contextOf(provider.id), ...args);
    }
    return Object.freeze(bound);
  };
  const services: Record<string, unknown> = {};
  for (const id of module.requires) {
    const provider = find(id);
    if (provider !== undefined) services[provider.contextName] = servicesOf(provider);
  }
  for (const id of module.optional) {
    const provider = find(id);
    services[provider?.contextName ?? camelFromKebab(id)] = buildMaybeAccessor(
      id,
      provider !== undefined,
      () => (provider === undefined ? {} : servicesOf(provider)),
      module.id,
      authorities,
    );
  }
  return Object.freeze(services);
}
