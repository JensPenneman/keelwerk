import { dirname } from 'node:path';
import type { LayoutWorkspace, WorkspacePackage } from './layout-workspace.ts';
import { listFiles } from './list-files.ts';
import { loadAppRoots } from './load-app-roots.ts';
import { loadModuleRoots } from './load-module-roots.ts';
import { readJsonFile } from './read-json-file.ts';

/** Reads the workspace under `root` once: its files, module roots, app roots and package manifests. */
export async function loadWorkspace(root: string): Promise<LayoutWorkspace> {
  const files = await listFiles(root);
  const packages: WorkspacePackage[] = [];
  for (const file of files.filter((candidate) => /(^|\/)package\.json$/.test(candidate))) {
    const manifest = await readJsonFile(`${root}/${file}`);
    if (manifest === undefined) continue;
    const dir = dirname(file) === '.' ? '' : dirname(file);
    packages.push({
      dir,
      manifest,
      tsconfig: await readJsonFile(`${root}/${dir === '' ? '' : `${dir}/`}tsconfig.json`),
    });
  }
  return {
    root,
    files,
    modules: await loadModuleRoots(root, files),
    apps: await loadAppRoots(root, files),
    packages,
    rootTsconfig: await readJsonFile(`${root}/tsconfig.json`),
  };
}
