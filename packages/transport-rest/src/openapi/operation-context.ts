import type { ApiSurface, SurfaceEntity } from '@keelwerk/core';

/** What building one operation needs beside the action and its route. */
export interface OperationContext {
  readonly surface: ApiSurface;
  readonly entity: SurfaceEntity | undefined;
  readonly version: '3.1' | '3.2';
  /** Names of the security schemes, sorted. */
  readonly securityNames: readonly string[];
}
