import type { ApiSurface, SurfaceAction } from '@keelwerk/core';

/** The actions of the surface that carry a `cli.login` hint (section 16.9.6), by reference. */
export function loginActionsOf(surface: ApiSurface): readonly SurfaceAction[] {
  return surface.actions.filter((action) => action.hints.cli?.login !== undefined);
}
