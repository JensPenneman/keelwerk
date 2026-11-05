import type { AnyModule } from '../model/any-module.ts';
import { runtimeModule } from '../registry/runtime-module.ts';
import type { SchemaPlanner, SchemaTrack } from '../runtime/schema-planner.ts';

/**
 * The migration tracks of the modules that ship a `migrations` directory (S-08), loaded through
 * the planner; a module without one has none. `selections` lists the module ids each served app
 * selects: a track that no app activates is dormant and is left out (section 14.6.1), so the build
 * id covers what some app applies.
 */
export async function loadModuleMigrations(
  planner: SchemaPlanner,
  modules: readonly AnyModule[],
  selections: readonly (readonly string[])[],
): Promise<readonly SchemaTrack[]> {
  const tracks: SchemaTrack[] = [];
  for (const module of modules) {
    const runtime = runtimeModule(module);
    if (runtime.migrations === undefined) continue;
    for (const track of await planner.loadTracks(runtime.id, runtime.migrations)) {
      if (selections.some((selected) => planner.isTrackActive(track.track, selected))) {
        tracks.push(track);
      }
    }
  }
  return tracks;
}
