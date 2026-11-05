import type { SurfaceChange } from '@keelwerk/core';

/** One classified difference between the base and the working tree, for one app and API version. */
export interface SurfaceDiffEntry {
  readonly app: string;
  readonly version: string;
  readonly change: SurfaceChange;
}
