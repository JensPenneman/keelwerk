import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EntityEntry, TrackSnapshot } from '@keelwerk/core';
import {
  buildTrackSnapshot,
  loadMigrations,
  parseTrackId,
  type TrackMigrations,
  trackDirectoryName,
} from '@keelwerk/data';
import type { AppDerivation } from './app-derivation.ts';
import type { MigrationTarget } from './migration-target.ts';
import { moduleDirectories } from './module-directories.ts';
import { standaloneModule } from './standalone-module-app.ts';
import { trackOfField } from './track-of-field.ts';

interface TargetSource {
  readonly id: string;
  readonly entries: readonly EntityEntry[];
}

/**
 * The module packages of the workspace that no app reaches, each composed alone, so a package such
 * as an auth module is checked against its own snapshot even when no app of the workspace uses it.
 */
async function aloneSources(
  modules: ReadonlyMap<string, string>,
  sources: readonly TargetSource[],
  shippedOnly: boolean,
): Promise<readonly TargetSource[]> {
  const reached = new Set<string>();
  for (const source of sources) {
    for (const track of buildTrackSnapshot(source.entries, { trackOfField }).keys()) {
      reached.add(parseTrackId(track).module);
    }
  }
  const alone: TargetSource[] = [];
  for (const [module, moduleRoot] of modules) {
    if (reached.has(module) || moduleRoot.includes('/test/fixtures/')) continue;
    if (shippedOnly && !existsSync(join(moduleRoot, 'migrations'))) continue;
    const found = await standaloneModule(moduleRoot);
    if (found !== undefined) alone.push(found);
  }
  return alone;
}

async function committedOf(
  module: string,
  directory: string,
  track: string,
): Promise<TrackMigrations> {
  const tracks = await loadMigrations(module, pathToFileURL(`${join(directory, 'migrations')}/`));
  return (
    tracks.find((candidate) => candidate.track === track) ?? { track, snapshot: null, files: [] }
  );
}

/**
 * The migration tracks of the workspace that the apps' definitions describe and a module package
 * of the workspace can hold (sections 14.6.1 and 14.8.5). A track whose module lies outside the
 * workspace (the core's, an installed package) has no directory here and is left out; a track two
 * apps both describe is read from the first app. With `shippedOnly` a module counts only when its
 * package has a `migrations/` directory, the way the generated manifest decides whether it ships
 * migrations (section 23.5): a module without one is provisioned from its definitions.
 */
export async function migrationTargets(
  root: string,
  apps: readonly AppDerivation[],
  shippedOnly: boolean,
): Promise<readonly MigrationTarget[]> {
  const modules = await moduleDirectories(root);
  const targets: MigrationTarget[] = [];
  const seen = new Set<string>();
  const sources: TargetSource[] = apps.map((app) => ({
    id: app.app.id,
    entries: [...app.app.registry.entities.values()],
  }));
  sources.push(...(await aloneSources(modules, sources, shippedOnly)));
  for (const app of sources) {
    const entries = app.entries;
    const bare = buildTrackSnapshot(entries, { trackOfField });
    const previous = new Map<string, TrackSnapshot>();
    const committed = new Map<string, TrackMigrations>();
    const directories = new Map<string, string>();
    for (const track of bare.keys()) {
      const { module } = parseTrackId(track);
      const moduleRoot = modules.get(module);
      if (moduleRoot === undefined) continue;
      if (shippedOnly && !existsSync(join(moduleRoot, 'migrations'))) continue;
      const directory = join(moduleRoot, 'migrations', trackDirectoryName(track));
      directories.set(track, directory);
      const loaded = await committedOf(module, moduleRoot, track);
      committed.set(track, loaded);
      if (loaded.snapshot !== null) previous.set(track, loaded.snapshot);
    }
    const desired = buildTrackSnapshot(entries, { trackOfField, previous });
    for (const [track, directory] of directories) {
      const snapshot = desired.get(track);
      const loaded = committed.get(track);
      if (snapshot === undefined || loaded === undefined || seen.has(directory)) continue;
      seen.add(directory);
      targets.push({
        track,
        module: parseTrackId(track).module,
        app: app.id,
        directory,
        desired: snapshot,
        committed: loaded,
      });
    }
  }
  return targets;
}
