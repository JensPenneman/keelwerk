import type { SurfaceSource } from '@keelwerk/core';
import type { OpenedPlacement } from './opened-placement.ts';

/** The apps a placement hosts: those it names, or every app when it names none. */
export function hostedApps(
  placement: OpenedPlacement,
  apps: readonly SurfaceSource[],
): readonly SurfaceSource[] {
  return apps.filter((app) => placement.apps === undefined || placement.apps.includes(app.id));
}
