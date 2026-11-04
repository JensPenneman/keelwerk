import { readdir, readFile } from 'node:fs/promises';
import type { MigrationFile, TrackSnapshot } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { parseSnapshot } from './parse-snapshot.ts';
import { trackOfDirectory } from './track-of-directory.ts';

const filePattern = /^(\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\.(?:ts|js)$/;

async function exists(url: URL): Promise<boolean> {
  try {
    await readdir(url);
    return true;
  } catch {
    return false;
  }
}

async function loadTrack(
  module: string,
  directory: URL,
  name: string,
): Promise<TrackMigrations | null> {
  const track = trackOfDirectory(module, name);
  if (track === null) return null;
  const dir = new URL(`${name}/`, directory);
  const entries = (await readdir(dir)).sort();
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const match = filePattern.exec(entry);
    if (match === null || entry.endsWith('.d.ts')) continue;
    const loaded: unknown = await import(new URL(entry, dir).href);
    const migration = (loaded as { readonly migration?: MigrationFile }).migration;
    if (migration === undefined) {
      throw errors.validation(`${name}/${entry} does not export \`migration\``);
    }
    if (migration.id !== match[1] || migration.track !== track) {
      throw errors.validation(
        `${name}/${entry} declares ${migration.track} ${migration.id}, expected ${track} ${match[1]}`,
      );
    }
    files.push(migration);
  }
  files.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let snapshot: TrackSnapshot | null = null;
  try {
    snapshot = parseSnapshot(await readFile(new URL('snapshot.json', dir), 'utf8'));
  } catch (error) {
    if ((error as { readonly code?: string }).code !== 'ENOENT') throw error;
  }
  return { track, snapshot, files };
}

/** One track as it lies on disk: its snapshot and its files in id order. */
export interface TrackMigrations {
  readonly track: string;
  /** Null until the track has a file. */
  readonly snapshot: TrackSnapshot | null;
  readonly files: readonly MigrationFile[];
}

/**
 * Reads the migration tracks of a module package: every directory under `migrations` named by
 * section 14.6.1 (`own`, `to-<target>`, `when-<module>`), its `snapshot.json` and its `NNNN-<name>`
 * files, `.ts` in development and `.js` once compiled (S-08). A file that does not export
 * `migration` (S-56), or whose id or track disagrees with its place, is a validation error. A
 * module without a directory has no tracks.
 */
export async function loadMigrations(
  module: string,
  migrations: URL,
): Promise<readonly TrackMigrations[]> {
  const directory = migrations.href.endsWith('/') ? migrations : new URL(`${migrations.href}/`);
  if (!(await exists(directory))) return [];
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const tracks: TrackMigrations[] = [];
  for (const name of names) {
    const loaded = await loadTrack(module, directory, name);
    if (loaded !== null) tracks.push(loaded);
  }
  return tracks;
}
