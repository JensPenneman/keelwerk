import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { shownPath } from './shown-path.ts';

/**
 * The files of a generated directory that belong to no API version of the app (a version removed
 * from `defineApiVersions` leaves its document behind). `keep` holds the names that do belong.
 */
export async function orphanFiles(
  root: string,
  directory: string,
  keep: ReadonlySet<string>,
  appId: string,
): Promise<readonly string[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !keep.has(entry.name))
    .map(
      (entry) =>
        `${shownPath(root, join(directory, entry.name))} belongs to no API version of ${appId}`,
    );
}
