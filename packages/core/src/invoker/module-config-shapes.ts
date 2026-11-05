import { coreBackendConfig } from '../control/core-backend-config.ts';
import type { ConfigurableModule } from '../control/create-backend.ts';
import type { Shape } from '../fields/shape.ts';

/** The config shape of each module of an app that declares one, by module id; the core's own is included. */
export function moduleConfigShapes(
  modules: readonly ConfigurableModule[],
): ReadonlyMap<string, Shape> {
  const shapes = new Map<string, Shape>([['core', coreBackendConfig]]);
  for (const module of modules) {
    if (module.base?.config !== undefined) shapes.set(module.id, module.base.config);
  }
  return shapes;
}
