import type { SurfaceAction } from '@keelwerk/core';

/** Whether the router has a procedure for the action: `hints.trpc.expose: false` hides it, whatever its kind. */
export function isTrpcExposed(action: SurfaceAction): boolean {
  return action.hints.trpc?.expose !== false;
}
