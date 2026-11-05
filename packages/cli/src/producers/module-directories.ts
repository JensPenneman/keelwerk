import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findRoots } from './find-roots.ts';

/** The module id to the root of its package, for every module root of the workspace that declares a literal id. */
export async function moduleDirectories(root: string): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  for (const directory of await findRoots(root, 'module')) {
    const base = await readFile(join(directory, 'src', 'base.ts'), 'utf8');
    const id = /\bid:\s*'([a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/.exec(base)?.[1];
    if (id !== undefined && !found.has(id)) found.set(id, directory);
  }
  return found;
}
