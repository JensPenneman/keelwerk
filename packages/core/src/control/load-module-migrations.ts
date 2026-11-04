import type { AnyModule } from '../model/any-module.ts';
import { runtimeModule } from '../registry/runtime-module.ts';
import type { SchemaPlanner, SchemaTrack } from '../runtime/schema-planner.ts';

/**
 * The migration tracks of the modules that ship a `migrations` directory (S-08), loaded through
 * the planner; a module without one has none.
 */
export async function loadModuleMigrations(
  planner: SchemaPlanner,
  modules: readonly AnyModule[],
): Promise<readonly SchemaTrack[]> {
  const tracks: SchemaTrack[] = [];
  for (const module of modules) {
    const runtime = runtimeModule(module);
    if (runtime.migrations === undefined) continue;
    tracks.push(...(await planner.loadTracks(runtime.id, runtime.migrations)));
  }
  return tracks;
}
