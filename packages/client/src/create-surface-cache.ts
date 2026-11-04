import type { ApiSurface } from '@keelwerk/core';
import type { LoadedSurface, SurfaceCache } from './surface-cache.ts';

function index(surface: ApiSurface): LoadedSurface {
  return {
    surface,
    actions: new Map(surface.actions.map((action) => [action.ref, action])),
    errors: new Map(surface.errors.map((error) => [error.code, error])),
  };
}

/**
 * Loads the surface once and keeps it; a failed load is not kept, so the next call tries again.
 * A committed surface skips the request.
 */
export function createSurfaceCache(
  load: () => Promise<ApiSurface>,
  committed: ApiSurface | undefined,
): SurfaceCache {
  let pending: Promise<LoadedSurface> | undefined =
    committed === undefined ? undefined : Promise.resolve(index(committed));
  return {
    get(): Promise<LoadedSurface> {
      if (pending === undefined) {
        const attempt = load().then(index);
        pending = attempt;
        attempt.catch(() => {
          if (pending === attempt) pending = undefined;
        });
      }
      return pending;
    },
  };
}
