import type { ActionHandler } from './action-handler.ts';
import type { RuntimeModule } from './runtime-module.ts';
import type { ServiceEntry } from './service-entry.ts';

/** The services of the modules by reference (section 5.5). */
export function buildServiceEntries(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, ServiceEntry> {
  const services = new Map<string, ServiceEntry>();
  for (const module of ordered) {
    for (const [name, part] of Object.entries(module.services)) {
      const ref = `${module.id}.${name}`;
      services.set(ref, {
        ref,
        module: module.id,
        name,
        fn: Reflect.get(part, 'fn') as ActionHandler,
      });
    }
  }
  return services;
}
