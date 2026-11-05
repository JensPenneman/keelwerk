import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SKIPPED: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.git',
  '.keelwerk',
  'coverage',
]);

async function walk(root: string, relative: string, found: string[]): Promise<void> {
  const entries = await readdir(join(root, relative), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (SKIPPED.has(entry.name)) continue;
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) await walk(root, path, found);
    else if (entry.isFile()) found.push(path);
  }
}

/** Every file below `root` as a path relative to it with `/` separators, without dependencies, build output and caches. */
export async function listFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  await walk(root, '', found);
  return found.toSorted();
}
