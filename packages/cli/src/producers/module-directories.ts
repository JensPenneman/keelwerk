import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findRoots } from './find-roots.ts';
import { shownPath } from './shown-path.ts';

/**
 * The module id to the root of its package, for every module root of the workspace that declares a
 * literal id. A root under a `test/fixtures` directory never shadows a workspace package with the
 * same id (it stands for the id only when no other root has it); two other roots with one id are
 * an error naming both.
 */
export async function moduleDirectories(root: string): Promise<ReadonlyMap<string, string>> {
  const packages = new Map<string, string>();
  const fixtures = new Map<string, string>();
  for (const directory of await findRoots(root, 'module')) {
    const base = await readFile(join(directory, 'src', 'base.ts'), 'utf8');
    const id = /\bid:\s*'([a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/.exec(base)?.[1];
    if (id === undefined) continue;
    if (`/${shownPath(root, directory)}/`.includes('/test/fixtures/')) {
      if (!fixtures.has(id)) fixtures.set(id, directory);
      continue;
    }
    const other = packages.get(id);
    if (other !== undefined) {
      throw new Error(
        `module id ${id} is declared by two roots: ${shownPath(root, other)} and ${shownPath(root, directory)}`,
      );
    }
    packages.set(id, directory);
  }
  return new Map([...fixtures, ...packages]);
}
