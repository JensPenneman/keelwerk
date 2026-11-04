import type { ApiSurface } from '@keelwerk/core';

/** The answer of `GET /surface` to a conditional request. */
export type SurfaceLookup =
  | { readonly modified: true; readonly surface: ApiSurface }
  | { readonly modified: false };
