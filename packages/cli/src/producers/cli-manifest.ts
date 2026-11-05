import { join } from 'node:path';
import { renderCliManifest } from '../manifest/render-cli-manifest.ts';
import type { AppDerivation } from './app-derivation.ts';
import { orphanFiles } from './orphan-files.ts';
import type { ProducedFiles } from './produced-files.ts';
import type { ProducerFile } from './producer-file.ts';

/** `generated/cli/<app>/<api version>.json` of each app and version (section 16.9.9). */
export async function produceCliManifests(
  root: string,
  apps: readonly AppDerivation[],
  check: boolean,
): Promise<ProducedFiles> {
  const files: ProducerFile[] = [];
  const failures: string[] = [];
  const notes: string[] = [];
  for (const app of apps) {
    const directory = join(app.directory, 'generated', 'cli', app.app.id);
    const keep = new Set<string>();
    app.dates.forEach((date, index) => {
      const surface = app.surfaces[index];
      if (surface === undefined) return;
      keep.add(`${date}.json`);
      files.push({ path: join(directory, `${date}.json`), text: renderCliManifest(surface) });
    });
    (check ? failures : notes).push(...(await orphanFiles(root, directory, keep, app.app.id)));
  }
  return { files, notes, failures };
}
