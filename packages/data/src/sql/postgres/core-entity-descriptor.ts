import type { EntityDescriptor } from '@keelwerk/core';
import { buildRegistry, defineApp, errors } from '@keelwerk/core';

/** The descriptor of the core entity `ref` as an app without modules composes it. */
export function coreEntityDescriptor(ref: string): EntityDescriptor {
  const { modules } = defineApp({ id: 'core-entities', modules: [] });
  const registry = buildRegistry({
    kind: 'app',
    id: 'core-entities',
    modules,
    execution: {},
    appActions: {},
    authorization: {},
    policies: {},
    api: null,
  });
  const entry = registry.entities.get(ref);
  if (entry === undefined) throw errors.internal(`the core module has no ${ref.slice(5)} entity`);
  return entry.descriptor;
}
