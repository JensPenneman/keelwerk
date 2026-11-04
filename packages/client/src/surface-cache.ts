import type { ApiSurface, SurfaceAction, SurfaceError } from '@keelwerk/core';

/** A surface with its actions and errors indexed. */
export interface LoadedSurface {
  readonly surface: ApiSurface;
  readonly actions: ReadonlyMap<string, SurfaceAction>;
  readonly errors: ReadonlyMap<string, SurfaceError>;
}

/** The surface of one client, loaded on first use. */
export interface SurfaceCache {
  get(): Promise<LoadedSurface>;
}
