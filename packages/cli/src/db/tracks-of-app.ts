import type { SchemaTrack, SurfaceSource } from '@keelwerk/core';
import { schemaPlanner } from '@keelwerk/data';

/**
 * The migration tracks an app's modules ship and the app selects (the packages that have a `migrations/` directory,
 * S-08), loaded through the planner and in run order (section 14.6.3).
 */
export async function tracksOfApp(app: SurfaceSource): Promise<readonly SchemaTrack[]> {
  const planner = schemaPlanner();
  const loaded: SchemaTrack[] = [];
  const selected = app.modules.map((module) => module.id);
  for (const module of app.modules) {
    if (module.migrations === undefined) continue;
    for (const track of await planner.loadTracks(module.id, module.migrations)) {
      if (planner.isTrackActive(track.track, selected)) loaded.push(track);
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
