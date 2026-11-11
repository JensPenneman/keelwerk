import type { ApiSurface, SurfaceAction } from '@keelwerk/core';
import { isProjected } from './is-projected.ts';

/**
 * The generated `get` of an entity that the schema serves, or `undefined`: an entity whose `get`
 * is hidden (`hints.graphql.expose: false`) has no reference objects, no `node` and no loader, so
 * the hidden action is never invoked through them.
 */
export function projectedGetOf(surface: ApiSurface, entity: string): SurfaceAction | undefined {
  return surface.actions.find(
    (action) => action.entity === entity && action.generated === 'get' && isProjected(action),
  );
}
