import type { ApiSurface, SurfaceAction } from '@keelwerk/core';

/** A copy of a surface with more actions, sorted by ref. */
export function withActions(surface: ApiSurface, ...extra: SurfaceAction[]): ApiSurface {
  return {
    ...surface,
    actions: [...surface.actions, ...extra].sort((left, right) => (left.ref < right.ref ? -1 : 1)),
  };
}
