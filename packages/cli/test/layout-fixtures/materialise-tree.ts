import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { version } from '@keelwerk/core';
import {
  renderModuleManifest,
  scanModuleDirectory,
  writeModuleManifest,
} from '@keelwerk/core/manifest';
import { loadWorkspace } from '../../src/layout/load-workspace.ts';

/** The directories this process made, removed by `removeTrees`. */
const made: string[] = [];

/** Writes `files` (path to text) into a fresh temporary directory and returns it. */
export async function materialise(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'keelwerk-layout-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Writes `src/module.generated.ts` of every module root under `root`, as `keelwerk generate` does. */
export async function writeManifests(root: string): Promise<void> {
  const workspace = await loadWorkspace(root);
  for (const module of workspace.modules) {
    if (module.sugar || module.id === undefined) continue;
    const text = renderModuleManifest({
      id: module.id,
      generatorVersion: version,
      scanned: scanModuleDirectory(module.files),
      migrations: module.hasMigrations,
    });
    await writeModuleManifest(join(root, module.dir, 'src', 'module.generated.ts'), text);
  }
}

/** Removes every directory `materialise` made. */
export async function removeTrees(): Promise<void> {
  await Promise.all(made.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
