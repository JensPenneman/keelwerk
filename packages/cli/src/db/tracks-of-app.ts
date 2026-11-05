import type { SchemaTrack, SurfaceSource } from '@keelwerk/core';
import { schemaPlanner } from '@keelwerk/data';

/**
 * The migration tracks an app's modules ship (the packages that have a `migrations/` directory,
 * S-08), loaded through the planner and in run order (section 14.6.3).
 */
export async function tracksOfApp(app: SurfaceSource): Promise<readonly SchemaTrack[]> {
  const planner = schemaPlanner();
  const loaded: SchemaTrack[] = [];
  for (const module of app.modules) {
    if (module.migrations !== undefined) {
      loaded.push(...(await planner.loadTracks(module.id, module.migrations)));
    }
  }
  const order = planner.orderTracks(
    app.registry.modules.map((module) => ({
      id: module.id,
      requires: module.requires,
      optional: module.optional,
    })),
    loaded.map((track) => track.track),
  );
  const byTrack = new Map(loaded.map((track) => [track.track, track]));
  return order.flatMap((track) => {
    const found = byTrack.get(track);
    return found === undefined ? [] : [found];
  });
}
